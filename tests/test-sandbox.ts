#!/usr/bin/env npx tsx
/**
 * test-sandbox.ts - Verify that sandbox.ts creates proper isolated environments
 * 
 * Tests:
 * 1. No args shows usage
 * 2. -spawn creates isolated server (data only)
 * 3. -spawn -copycode creates full isolation with junctions
 * 4. -list shows running servers
 * 5. -kill terminates server
 * 6. -remove kills and deletes directory
 * 7. Safety checks prevent killing non-test processes
 * 
 * Usage: npx tsx tests/test-sandbox.ts
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const APP_ROOT = path.resolve(__dirname, "..");
const TEST_DIRS_ROOT = path.join(APP_ROOT, "testDirs");
const SANDBOX = path.join(APP_ROOT, "scripts", "sandbox.ts");

// Test state
let testPort = 0;
let testDir = "";
let passCount = 0;
let failCount = 0;

// Colors
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";
const RESET = "\x1b[0m";

function log(msg: string) {
  console.log(msg);
}

function pass(name: string) {
  passCount++;
  log(`${GREEN}✓ ${name}${RESET}`);
}

function fail(name: string, reason?: string) {
  failCount++;
  log(`${RED}✗ ${name}${reason ? `: ${reason}` : ""}${RESET}`);
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

/**
 * Run SANDBOX command and return stdout.
 */
function runSANDBOX(args: string[]): { stdout: string; stderr: string; exitCode: number } {
  try {
    const result = execSync(`npx tsx "${SANDBOX}" ${args.join(" ")}`, {
      cwd: APP_ROOT,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { stdout: result, stderr: "", exitCode: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      exitCode: err.status || 1
    };
  }
}

/**
 * Spawn SANDBOX.ts and wait for READY signal.
 * SANDBOX now exits after printing READY, server keeps running.
 * Returns the port number, or 0 on failure.
 */
async function spawnTestServer(copyCode: boolean): Promise<number> {
  const args = ["-spawn"];
  if (copyCode) args.push("-copycode");
  
  // Use execSync - simple and reliable. SANDBOX exits after READY, server keeps running.
  const { stdout, exitCode } = runSANDBOX(args);
  
  if (exitCode !== 0) {
    return 0;
  }
  
  const match = stdout.match(/READY\s+(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/**
 * Clean up via SANDBOX -remove (preferred method).
 */
function cleanupViaSANDBOX(): void {
  if (testPort) {
    runSANDBOX(["-remove", String(testPort)]);
  }
}

/**
 * Clean up test directory with retries.
 */
async function cleanupTestDir(): Promise<boolean> {
  if (!testDir || !fs.existsSync(testDir)) {
    return true;
  }
  
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
      return true;
    } catch (err) {
      if (attempt < 4) {
        await sleep(500);
      }
    }
  }
  return false;
}

// ============================================================================
// TESTS
// ============================================================================

async function testUsage(): Promise<void> {
  log(`\n${CYAN}Test: Usage display${RESET}`);
  
  const { stdout, exitCode } = runSANDBOX([]);
  
  if (exitCode === 0) {
    pass("No args exits with code 0");
  } else {
    fail("No args exits with code 0", `Got ${exitCode}`);
  }
  
  if (stdout.includes("Usage:") && stdout.includes("-spawn") && stdout.includes("-list")) {
    pass("Usage text includes commands");
  } else {
    fail("Usage text includes commands");
  }
  
  if (stdout.includes("60000")) {
    pass("Usage mentions port range");
  } else {
    fail("Usage mentions port range");
  }
}

async function testBasicSpawn(): Promise<void> {
  log(`\n${CYAN}Test: Basic spawn (no -copycode)${RESET}`);
  
  testPort = await spawnTestServer(false);
  if (!testPort) {
    fail("Server started", "Did not receive READY signal");
    return;
  }
  pass("Server started");
  
  testDir = path.join(TEST_DIRS_ROOT, `TEST_${testPort}`);
  
  // Check directory exists
  if (fs.existsSync(testDir)) {
    pass("TEST_<port>/ directory created");
  } else {
    fail("TEST_<port>/ directory created");
    return;
  }
  
  // Check data directories exist
  const dataDirs = ["dataUsers", "dataUserPrefs", "dataTrips", "dataConfig"];
  for (const dir of dataDirs) {
    if (fs.existsSync(path.join(testDir, dir))) {
      pass(`${dir}/ copied`);
    } else {
      fail(`${dir}/ copied`);
    }
  }
  
  // Check PID file exists
  const pidFile = path.join(testDir, "server.pid");
  if (fs.existsSync(pidFile)) {
    const pid = fs.readFileSync(pidFile, "utf-8").trim();
    if (/^\d+$/.test(pid)) {
      pass(`server.pid exists with valid PID (${pid})`);
    } else {
      fail("server.pid has valid content", `Got: ${pid}`);
    }
  } else {
    fail("server.pid exists");
  }
  
  // Check code directories do NOT exist (no -copycode)
  if (!fs.existsSync(path.join(testDir, "server"))) {
    pass("server/ NOT copied (expected without -copycode)");
  } else {
    fail("server/ NOT copied");
  }
  
  // Check server responds to ping
  try {
    const resp = await fetch(`http://localhost:${testPort}/ping`, {
      signal: AbortSignal.timeout(2000)
    });
    if (resp.ok && (await resp.text()).trim() === "pong") {
      pass("Server responds to /ping");
    } else {
      fail("Server responds to /ping", `Got ${resp.status}`);
    }
  } catch (err) {
    fail("Server responds to /ping", String(err));
  }
  
  // Don't cleanup yet - we'll test -list and -kill
}

async function testList(): Promise<void> {
  log(`\n${CYAN}Test: -list command${RESET}`);
  
  if (!testPort) {
    fail("-list test", "No server running from previous test");
    return;
  }
  
  const { stdout, exitCode } = runSANDBOX(["-list"]);
  
  if (exitCode === 0) {
    pass("-list exits with code 0");
  } else {
    fail("-list exits with code 0", `Got ${exitCode}`);
  }
  
  if (stdout.includes(String(testPort))) {
    pass(`-list shows port ${testPort}`);
  } else {
    fail(`-list shows port ${testPort}`);
  }
  
  if (stdout.includes("RUNNING")) {
    pass("-list shows RUNNING status");
  } else {
    fail("-list shows RUNNING status", stdout);
  }
  
  if (stdout.includes("yes")) {
    pass("-list shows directory exists");
  } else {
    fail("-list shows directory exists");
  }
}

async function testKill(): Promise<void> {
  log(`\n${CYAN}Test: -kill command${RESET}`);
  
  if (!testPort) {
    fail("-kill test", "No server running from previous test");
    return;
  }
  
  const { stdout, exitCode } = runSANDBOX(["-kill", String(testPort)]);
  
  if (exitCode === 0) {
    pass("-kill exits with code 0");
  } else {
    fail("-kill exits with code 0", `Got ${exitCode}`);
  }
  
  if (stdout.includes("Killed")) {
    pass("-kill reports success");
  } else {
    fail("-kill reports success", stdout);
  }
  
  // Verify server is actually dead
  await sleep(500);
  try {
    await fetch(`http://localhost:${testPort}/ping`, {
      signal: AbortSignal.timeout(1000)
    });
    fail("Server is stopped after -kill", "Server still responds");
  } catch {
    pass("Server is stopped after -kill");
  }
  
  // Directory should still exist
  if (fs.existsSync(testDir)) {
    pass("Directory still exists after -kill (not -remove)");
  } else {
    fail("Directory still exists after -kill");
  }
}

async function testRemove(): Promise<void> {
  log(`\n${CYAN}Test: -remove command${RESET}`);
  
  if (!testPort || !testDir) {
    fail("-remove test", "No test directory from previous test");
    return;
  }
  
  const { stdout, exitCode } = runSANDBOX(["-remove", String(testPort)]);
  
  if (exitCode === 0) {
    pass("-remove exits with code 0");
  } else {
    fail("-remove exits with code 0", `Got ${exitCode}`);
  }
  
  if (stdout.includes("Removed")) {
    pass("-remove reports directory removed");
  } else {
    fail("-remove reports directory removed", stdout);
  }
  
  // Verify directory is gone
  await sleep(500);
  if (!fs.existsSync(testDir)) {
    pass("Directory deleted after -remove");
  } else {
    fail("Directory deleted after -remove", "Directory still exists");
  }
  
  // Reset for next test
  testPort = 0;
  testDir = "";
}

async function testCopyCodeSpawn(): Promise<void> {
  log(`\n${CYAN}Test: Spawn with -copycode${RESET}`);
  
  testPort = await spawnTestServer(true);
  if (!testPort) {
    fail("Server started", "Did not receive READY signal");
    return;
  }
  pass("Server started");
  
  testDir = path.join(TEST_DIRS_ROOT, `TEST_${testPort}`);
  
  // Check code directories exist
  const codeDirs = ["scripts", "server", "client"];
  for (const dir of codeDirs) {
    if (fs.existsSync(path.join(testDir, dir))) {
      pass(`${dir}/ copied`);
    } else {
      fail(`${dir}/ copied`);
    }
  }
  
  // Check node_modules junctions exist
  for (const dir of ["server", "client"]) {
    const junctionPath = path.join(testDir, dir, "node_modules");
    if (fs.existsSync(junctionPath)) {
      const stats = fs.lstatSync(junctionPath);
      if (stats.isSymbolicLink()) {
        pass(`${dir}/node_modules/ is a junction`);
      } else {
        fail(`${dir}/node_modules/ is a junction`, "Exists but not a junction");
      }
    } else {
      fail(`${dir}/node_modules/ junction exists`);
    }
  }
  
  // Clean up using -remove (kills server first, then removes directory)
  const { exitCode } = runSANDBOX(["-remove", String(testPort)]);
  if (exitCode === 0 && !fs.existsSync(testDir)) {
    pass("-remove cleans up -copycode directory (junctions don't block)");
  } else {
    fail("-remove cleans up -copycode directory");
    await cleanupTestDir();
  }
  
  testPort = 0;
  testDir = "";
}

async function testSafetyChecks(): Promise<void> {
  log(`\n${CYAN}Test: Safety checks${RESET}`);
  
  // Test killing out-of-range port
  const { exitCode: exitCode1, stderr: stderr1, stdout: stdout1 } = runSANDBOX(["-kill", "3000"]);
  if (exitCode1 !== 0 && (stderr1 + stdout1).includes("must be")) {
    pass("-kill rejects out-of-range port");
  } else {
    fail("-kill rejects out-of-range port");
  }
  
  // Test killing non-existent port (should succeed gracefully)
  const { exitCode: exitCode2, stdout: stdout2 } = runSANDBOX(["-kill", "60999"]);
  if (exitCode2 === 0 && stdout2.includes("No server running")) {
    pass("-kill handles non-existent server gracefully");
  } else {
    fail("-kill handles non-existent server gracefully", stdout2);
  }
  
  // Test removing non-existent port
  const { exitCode: exitCode3, stdout: stdout3 } = runSANDBOX(["-remove", "60998"]);
  if (exitCode3 === 0 && stdout3.includes("does not exist")) {
    pass("-remove handles non-existent directory gracefully");
  } else {
    fail("-remove handles non-existent directory gracefully", stdout3);
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  log("=".repeat(60));
  log("  SANDBOX.TS TEST SUITE");
  log("=".repeat(60));
  
  try {
    await testUsage();
    await testBasicSpawn();
    await testList();
    await testKill();
    await testRemove();
    await testCopyCodeSpawn();
    await testSafetyChecks();
  } finally {
    // Ensure cleanup on any failure
    if (testPort) {
      runSANDBOX(["-remove", String(testPort)]);
    }
    await cleanupTestDir();
  }
  
  log("\n" + "=".repeat(60));
  log(`  Results: ${GREEN}${passCount} passed${RESET}, ${failCount > 0 ? RED : ""}${failCount} failed${RESET}`);
  log("=".repeat(60));
  
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch(async err => {
  console.error("Test suite crashed:", err);
  if (testPort) {
    runSANDBOX(["-remove", String(testPort)]);
  }
  await cleanupTestDir();
  process.exit(1);
});
