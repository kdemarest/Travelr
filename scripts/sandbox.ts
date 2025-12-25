#!/usr/bin/env npx tsx
/**
 * sandbox.ts - Spawn an isolated test server
 * 
 * PURPOSE:
 * Creates a fully isolated test environment that behaves identically to production.
 * The test server has NO special knowledge that it's a test - isolation comes purely
 * from running in a separate directory with copied data and code files.
 * 
 * HOW IT WORKS:
 * 1. Selects an available port from 60000-60999 (checks for existing TEST_<port>/ dirs)
 * 2. Creates testDirs/TEST_<port>/ directory
 * 3. Copies data directories (dataUsers/, dataTrips/, etc.) into TEST_<port>/
 * 4. Copies code directories (scripts/, server/, client/) into TEST_<port>/
 * 5. Creates junctions for node_modules (fast, no copying)
 * 6. Generates config.test.json with the selected port
 * 7. Builds the server (npm run build in server/)
 * 8. Starts the server FROM the test directory (so __dirname paths resolve there)
 * 9. Waits for server to be ready, then signals the parent process
 * 
 * PORT DISCOVERY:
 * The selected port is communicated to the parent process via stdout:
 *   - When server is ready, prints "READY <port>" to stdout (e.g., "READY 5000")
 *   - Parent should parse this line to discover which port was assigned
 *   - All other output goes to stderr (prefixed with [sandbox])
 * 
 * Example parent code:
 *   const proc = spawn("npx", ["tsx", "scripts/sandbox.ts"]);
 *   proc.stdout.on("data", (data) => {
 *     const match = data.toString().match(/READY\s+(\d+)/);
 *     if (match) {
 *       const port = parseInt(match[1], 10);
 *       // Server is ready on `port`
 *     }
 *   });
 * 
 * CLEANUP:
 * - The TEST_<port>/ directory is NOT auto-cleaned (useful for debugging)
 * - Kill this process to stop the server
 * - Manually delete TEST_<port>/ when done
 * 
 * Usage:
 *   npx tsx scripts/sandbox.ts                    # Show usage
 *   npx tsx scripts/sandbox.ts -spawn             # Auto-select port, spawn server
 *   npx tsx scripts/sandbox.ts -list              # List all test servers in 60000-60999 range
 *   npx tsx scripts/sandbox.ts -kill 60001        # Kill server on port 60001
 *   npx tsx scripts/sandbox.ts -remove 60001      # Kill server AND delete testDirs/TEST_60001/
 *   TEST_PORT=60042 npx tsx scripts/sandbox.ts -spawn  # Use specific port
 */

import { spawn, ChildProcess, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";
import netstat from "node-netstat";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CODE_ROOT = path.resolve(__dirname, "..");
const SERVER_DIR = path.join(CODE_ROOT, "server");

// Port range for test servers (60000-60999 is high enough to avoid conflicts)
const PORT_MIN = 60000;
const PORT_MAX = 60999;

// All test directories live under testDirs/ to reduce clutter
const TEST_DIRS_ROOT = path.join(CODE_ROOT, "testDirs");

// ============================================================================
// MANAGEMENT COMMANDS: -list, -kill, -remove
// ============================================================================

/**
 * Check if a port is in use by attempting to connect.
 */
async function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(500);
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.on("error", () => {
      resolve(false);
    });
    socket.connect(port, "127.0.0.1");
  });
}

/**
 * Get PID from server.pid file in test directory.
 */
function getPidFromFile(port: number): number | null {
  const pidFile = path.join(TEST_DIRS_ROOT, `TEST_${port}`, "server.pid");
  if (fs.existsSync(pidFile)) {
    try {
      const pid = parseInt(fs.readFileSync(pidFile, "utf-8").trim(), 10);
      if (!isNaN(pid)) return pid;
    } catch {
      // Ignore read errors
    }
  }
  return null;
}

/**
 * Get PID from port using netstat (fallback when no PID file).
 */
function getPidFromPort(port: number): Promise<number | null> {
  return new Promise((resolve) => {
    let foundPid: number | null = null;
    netstat({
      filter: { local: { port } },
      done: () => resolve(foundPid)
    }, (data) => {
      if (data.local.port === port && data.pid) {
        foundPid = data.pid;
      }
    });
  });
}

/**
 * List all test servers in the port range.
 */
async function listServers(): Promise<void> {
  console.log(`Test servers (port range ${PORT_MIN}-${PORT_MAX}):\n`);
  console.log("PORT    PID      DIR EXISTS   STATUS");
  console.log("─".repeat(50));
  
  let found = 0;
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    const dirExists = fs.existsSync(path.join(TEST_DIRS_ROOT, `TEST_${port}`));
    let pid = getPidFromFile(port);
    const portInUse = await isPortInUse(port);
    
    // Try netstat if no PID file but port is in use
    if (!pid && portInUse) {
      pid = await getPidFromPort(port);
    }
    
    if (dirExists || portInUse) {
      found++;
      const pidStr = pid ? String(pid).padEnd(8) : "?       ";
      const dirStr = dirExists ? "yes" : "no ";
      const statusStr = portInUse ? "RUNNING" : (dirExists ? "stopped" : "");
      console.log(`${port}   ${pidStr} ${dirStr}          ${statusStr}`);
    }
  }
  
  if (found === 0) {
    console.log("(no test servers found)");
  }
  console.log("");
}

/**
 * Kill a test server by port.
 * Only kills if we have evidence this is our server (PID file or directory exists).
 */
async function killServer(port: number): Promise<boolean> {
  // Safety check: must be in test port range
  if (port < PORT_MIN || port > PORT_MAX) {
    console.error(`Port ${port} is outside test range ${PORT_MIN}-${PORT_MAX}`);
    return false;
  }
  
  const dirExists = fs.existsSync(path.join(TEST_DIRS_ROOT, `TEST_${port}`));
  const pidFromFile = getPidFromFile(port);
  
  // Only kill if we have evidence this is our server
  if (!dirExists && !pidFromFile) {
    const portInUse = await isPortInUse(port);
    if (portInUse) {
      console.log(`Port ${port} is in use but no TEST_${port}/ directory or PID file exists.`);
      console.log(`Refusing to kill - this may not be a test server.`);
      return false;
    }
    console.log(`No server running on port ${port}`);
    return true;
  }
  
  // Try PID file first, then netstat
  let pid = pidFromFile;
  if (!pid) {
    pid = await getPidFromPort(port);
  }
  
  if (pid) {
    try {
      // Check if process exists first
      process.kill(pid, 0);
      // It exists, now kill it
      process.kill(pid, "SIGTERM");
      console.log(`Killed server on port ${port} (PID ${pid})`);
      
      // Clean up PID file if it exists
      const pidFile = path.join(TEST_DIRS_ROOT, `TEST_${port}`, "server.pid");
      try { fs.unlinkSync(pidFile); } catch { }
      
      return true;
    } catch (err: any) {
      if (err.code === "ESRCH") {
        console.log(`Server on port ${port} not running (stale PID)`);
        // Clean up stale PID file
        const pidFile = path.join(TEST_DIRS_ROOT, `TEST_${port}`, "server.pid");
        try { fs.unlinkSync(pidFile); } catch { }
        return true;
      }
      console.error(`Failed to kill server on port ${port}: ${err.message}`);
      return false;
    }
  }
  
  // Directory exists but no running process
  console.log(`No server running on port ${port}`);
  return true;
}

/**
 * Remove a test server - kill it and delete the directory.
 */
async function removeServer(port: number): Promise<boolean> {
  // Safety check: must be in test port range
  if (port < PORT_MIN || port > PORT_MAX) {
    console.error(`Port ${port} is outside test range ${PORT_MIN}-${PORT_MAX}`);
    return false;
  }
  
  await killServer(port);
  
  const dir = path.join(TEST_DIRS_ROOT, `TEST_${port}`);
  if (fs.existsSync(dir)) {
    // Give it a moment for handles to release
    await new Promise(r => setTimeout(r, 500));
    
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      console.log(`Removed directory: ${dir}`);
      return true;
    } catch (err: any) {
      console.error(`Failed to remove ${dir}: ${err.message}`);
      return false;
    }
  } else {
    console.log(`Directory does not exist: ${dir}`);
    return true;
  }
}

// ============================================================================
// COMMAND DISPATCH
// ============================================================================

// Check for management commands first
const args = process.argv.slice(2);

// Spawn mode variables (must be declared before dispatch since main() may be called)
let testPort: number;
let testDir: string;
let serverProcess: ChildProcess | null = null;

function showUsage(): void {
  console.log(`Usage: sandbox <command> [options]

Commands:
  -spawn               Start a new isolated test server
  -list                List all test servers in port range ${PORT_MIN}-${PORT_MAX}
  -kill <port>         Kill a test server by port
  -remove <port>       Kill and remove test server directory

Examples:
  sandbox -spawn
  sandbox -list
  sandbox -kill ${PORT_MIN + 1}
  sandbox -remove ${PORT_MIN + 1}
`);
}

if (args.length === 0) {
  showUsage();
  process.exit(0);
} else if (args.includes("-list")) {
  listServers().then(() => process.exit(0));
} else if (args.includes("-kill")) {
  const idx = args.indexOf("-kill");
  const port = parseInt(args[idx + 1], 10);
  if (isNaN(port) || port < PORT_MIN || port > PORT_MAX) {
    console.error(`Usage: sandbox -kill <port>  (port must be ${PORT_MIN}-${PORT_MAX})`);
    process.exit(1);
  }
  killServer(port).then(ok => process.exit(ok ? 0 : 1));
} else if (args.includes("-remove")) {
  const idx = args.indexOf("-remove");
  const port = parseInt(args[idx + 1], 10);
  if (isNaN(port) || port < PORT_MIN || port > PORT_MAX) {
    console.error(`Usage: sandbox -remove <port>  (port must be ${PORT_MIN}-${PORT_MAX})`);
    process.exit(1);
  }
  removeServer(port).then(ok => process.exit(ok ? 0 : 1));
} else if (args.includes("-spawn")) {
  main();
} else {
  console.error(`Unknown command: ${args[0]}`);
  showUsage();
  process.exit(1);
}

// ============================================================================
// SPAWN MODE (original functionality)
// ============================================================================

function log(msg: string) {
  console.error(`[sandbox] ${msg}`);
}

/**
 * Find an available port by checking if TEST_<port>/ directory exists.
 */
function findAvailablePort(): number {
  for (let port = PORT_MIN; port <= PORT_MAX; port++) {
    const dir = path.join(TEST_DIRS_ROOT, `TEST_${port}`);
    if (!fs.existsSync(dir)) {
      return port;
    }
  }
  throw new Error(`No available ports in range ${PORT_MIN}-${PORT_MAX}`);
}

/**
 * Create the isolated test directory with copies of data files.
 */
function createTestDirectory(port: number): string {
  // Ensure testDirs/ exists
  if (!fs.existsSync(TEST_DIRS_ROOT)) {
    fs.mkdirSync(TEST_DIRS_ROOT);
  }
  
  const dir = path.join(TEST_DIRS_ROOT, `TEST_${port}`);
  
  // Clean slate - delete if exists
  if (fs.existsSync(dir)) {
    log(`Removing existing test directory: ${dir}`);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  
  log(`Creating test directory: ${dir}`);
  fs.mkdirSync(dir);
  
  // Copy data directories
  const dataDirs = ["dataUsers", "dataUserPrefs", "dataTrips", "dataConfig", "dataCountries"];
  for (const dataDir of dataDirs) {
    const src = path.join(CODE_ROOT, dataDir);
    const dest = path.join(dir, dataDir);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
      log(`  Copied ${dataDir}/`);
    }
  }
  
  // Filter to skip node_modules and TEST_* when copying code
  // These would be huge/recursive and are not needed for tests
  const copyFilter = (src: string): boolean => {
    const basename = path.basename(src);
    if (basename === "node_modules") return false;
    if (basename.startsWith("TEST_")) return false;
    return true;
  };
  
  // Copy code directories (always - for full test fidelity)
  const codeDirs = ["scripts", "server", "client"];
  for (const codeDir of codeDirs) {
    const src = path.join(CODE_ROOT, codeDir);
    const dest = path.join(dir, codeDir);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true, filter: copyFilter });
      log(`  Copied ${codeDir}/`);
    }
  }
  // Also copy root package.json and tsconfig for npm commands
  for (const file of ["package.json", "tsconfig.base.json"]) {
    const src = path.join(CODE_ROOT, file);
    const dest = path.join(dir, file);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest);
      log(`  Copied ${file}`);
    }
  }
  
  // ========================================================================
  // JUNCTION LINKS FOR node_modules
  // ========================================================================
  // We copied server/ and client/ but SKIPPED their node_modules/ (huge!).
  // The copied code still needs to find its dependencies when it runs.
  // 
  // Solution: Create "junctions" - a Windows filesystem feature that acts
  // like a symlink for directories. When Node resolves require('express')
  // from TEST_5000/server/dist/, it walks up looking for node_modules/.
  // The junction at TEST_5000/server/node_modules/ transparently redirects
  // to CODE_ROOT/server/node_modules/, so modules are found.
  //
  // Why junctions instead of symlinks?
  // - Symlinks on Windows require admin rights or Developer Mode
  // - Junctions work without elevation for directories
  // - When we delete TEST_5000/, only the junction is deleted, not the
  //   real node_modules
  //
  // Note: Target path MUST be absolute on Windows.
  // ========================================================================
  const nodeModulesDirs = ["server", "client"];
  for (const subdir of nodeModulesDirs) {
    const realNodeModules = path.join(CODE_ROOT, subdir, "node_modules");
    const junctionPath = path.join(dir, subdir, "node_modules");
    if (fs.existsSync(realNodeModules)) {
      fs.symlinkSync(realNodeModules, junctionPath, "junction");
      log(`  Linked ${subdir}/node_modules/ (junction)`);
    }
  }
  
  // Create empty directories for logs and temp files
  fs.mkdirSync(path.join(dir, "dataDiagnostics"));
  fs.mkdirSync(path.join(dir, "dataTemp"));
  
  // Copy generic test config and patch the port
  const srcConfig = path.join(CODE_ROOT, "dataConfig", "config.test-generic.json");
  const destConfig = path.join(dir, "dataConfig", "config.test.json");
  const config = JSON.parse(fs.readFileSync(srcConfig, "utf-8"));
  config.port = port;
  fs.writeFileSync(destConfig, JSON.stringify(config, null, 2));
  log(`  Created config.test.json (port ${port})`);
  
  return dir;
}

/**
 * Build the server.
 */
async function buildServer(): Promise<void> {
  log("Building server...");
  
  return new Promise((resolve, reject) => {
    const proc = spawn("npm", ["run", "build"], {
      cwd: SERVER_DIR,
      stdio: ["ignore", "pipe", "pipe"],
      shell: true
    });
    
    let output = "";
    proc.stdout?.on("data", (d) => { output += d.toString(); });
    proc.stderr?.on("data", (d) => { output += d.toString(); });
    
    proc.on("close", (code) => {
      if (code === 0) {
        log("Build complete");
        resolve();
      } else {
        reject(new Error(`Build failed (code ${code}):\n${output}`));
      }
    });
    proc.on("error", reject);
  });
}

/**
 * Start the server from the test directory.
 */
function startServer(): void {
  log(`Starting server on port ${testPort} from ${testDir}...`);
  
  // Explicitly pass through important env vars
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    SYSTEMROOT: process.env.SYSTEMROOT,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    // API keys
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    GOOGLE_CS_API_KEY: process.env.GOOGLE_CS_API_KEY,
    GOOGLE_CS_CX: process.env.GOOGLE_CS_CX,
    // Auth passwords for system users (required for server to start)
    TRAVELR_ADMIN_PWD: process.env.TRAVELR_ADMIN_PWD,
    TRAVELR_DEPLOYBOT_PWD: process.env.TRAVELR_DEPLOYBOT_PWD,
    TRAVELR_TESTBOT_PWD: process.env.TRAVELR_TESTBOT_PWD,
    // Use the test config we generated
    TRAVELR_CONFIG: "test"
  };
  
  // WHERE THE SERVER CODE COMES FROM
  //
  // The server always runs from testDir, which contains a full copy of the code.
  // This ensures:
  // - Full test fidelity (environment matches dev/prod as closely as possible)
  // - Deploy-quick tests can overwrite files without affecting real code
  // - The test directory is a valid "project root" with dataConfig/, server/, etc.
  //
  // ============================================================================
  // WARNING: MANUAL DEBUGGING OF SANDBOX SERVERS
  // ============================================================================
  // If you're debugging a sandbox server failure by running it manually, you MUST
  // set the environment variables that sandbox.ts normally sets:
  //
  //   WRONG: cd testDirs\TEST_60008; node server/dist/server-runner.js
  //          (Uses config.dev-win11.json, port 4000, wrong config!)
  //
  //   RIGHT: cd testDirs\TEST_60008
  //          $env:TRAVELR_CONFIG="test"
  //          node server/dist/server-runner.js
  //          (Uses config.test.json with correct port)
  //
  // The sandbox sets TRAVELR_CONFIG="test" in the env passed to spawn().
  // ============================================================================
  //
  // We use server-runner.js instead of index.js so deploy-quick works correctly.
  // server-runner watches for exit code 99 and restarts the server.
  //
  const serverScript = path.join(testDir, "server", "dist", "server-runner.js");
  
  // On Windows, we need fully detached stdio for the process to survive parent exit.
  // Server output goes to a diagnostic log file for later analysis if needed.
  // Ensure the diagnostics directory exists (sandbox owns this log file).
  const diagnosticsDir = path.join(CODE_ROOT, "dataDiagnostics");
  if (!fs.existsSync(diagnosticsDir)) {
    fs.mkdirSync(diagnosticsDir, { recursive: true });
  }
  const logFile = path.join(diagnosticsDir, "sandbox.log");
  const logFd = fs.openSync(logFile, "a");  // Append mode - multiple servers can share
  
  // Write a header so we can tell runs apart
  fs.writeSync(logFd, `\n${"=".repeat(60)}\n[${new Date().toISOString()}] Starting server on port ${testPort}\n${"=".repeat(60)}\n`);
  
  serverProcess = spawn("node", [serverScript], {
    cwd: testDir,
    env,
    stdio: ["ignore", logFd, logFd],
    detached: true
  });
  
  // Unref so sandbox can exit while server keeps running
  serverProcess.unref();
  
  serverProcess.on("close", (code) => {
    log(`Server exited with code ${code}`);
    serverProcess = null;
  });
  
  serverProcess.on("error", (err) => {
    log(`Server error: ${err}`);
  });
}

/**
 * Wait for server to respond to /ping.
 */
async function waitForReady(maxWaitMs = 30000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500;
  const testServer = `http://localhost:${testPort}`;
  
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const resp = await fetch(`${testServer}/ping`, {
        signal: AbortSignal.timeout(1000)
      });
      if (resp.ok && (await resp.text()).trim() === "pong") {
        return true;
      }
    } catch {
      // Not ready yet
    }
    await new Promise(r => setTimeout(r, pollInterval));
  }
  return false;
}

async function main() {
  try {
    // Determine port
    testPort = process.env.TEST_PORT ? parseInt(process.env.TEST_PORT, 10) : findAvailablePort();
    if (testPort < PORT_MIN || testPort > PORT_MAX) {
      throw new Error(`TEST_PORT must be in range ${PORT_MIN}-${PORT_MAX}`);
    }
    log(`Using port ${testPort}`);
    
    // Create isolated test directory
    testDir = createTestDirectory(testPort);
    
    // Build server
    await buildServer();
    
    // Start server from test directory (detached - keeps running after we exit)
    startServer();
    
    // Wait for ready
    const ready = await waitForReady(30000);
    if (!ready) {
      log("Server did not become ready within 30 seconds");
      // Try to kill it via the management command
      await killServer(testPort);
      process.exit(1);
    }
    
    // Signal that we're ready (include port so caller knows which one)
    console.log(`READY ${testPort}`);
    log(`Server running on port ${testPort}`);
    log(`Test directory: ${testDir}`);
    log(`To stop: sandbox -kill ${testPort}`);
    log(`To remove: sandbox -remove ${testPort}`);
    
    // Exit - server keeps running independently
    process.exit(0);
    
  } catch (err) {
    log(`Error: ${err}`);
    // Try to clean up if we created a directory
    if (testPort) {
      await killServer(testPort);
    }
    process.exit(1);
  }
}
