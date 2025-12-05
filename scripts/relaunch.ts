#!/usr/bin/env npx tsx
/**
 * relaunch.ts - Deploy-quick helper script (DEPRECATED)
 * 
 * ============================================================================
 * WARNING: THIS APPROACH IS DEPRECATED
 * ============================================================================
 * This script was designed to run as a detached process, handling deploy-quick
 * by waiting for the server to exit, then extracting/building/restarting.
 * 
 * It DOES NOT WORK in Docker with dumb-init because:
 *   1. Server spawns this script detached
 *   2. Server exits
 *   3. dumb-init (PID 1) sees its child exit → kills container
 *   4. This script dies before it can do anything
 * 
 * The NEW approach uses server-runner.ts:
 *   - server-runner runs the server as a child
 *   - Server does extract/build while still running (responds to health checks)
 *   - Server exits with code 99
 *   - server-runner sees code 99, restarts the server
 *   - No separate process, no race conditions
 * 
 * This file is kept for reference and may be removed in the future.
 * ============================================================================
 * 
 * Original description:
 * This script is spawned by the server when it receives a deploy-quick request.
 * It runs as a detached process and:
 * 1. Waits for the server to shut down (PID file disappears)
 * 2. Extracts the new code from the zip
 * 3. Runs npm install if package.json changed
 * 4. Rebuilds the TypeScript
 * 5. Restarts the server
 * 
 * IMPORTANT: This script operates entirely on process.cwd(). It has no knowledge
 * of any specific directory structure. The caller controls where it runs from.
 * In production, cwd is /app. In tests, cwd is TEST_5000/. Same behavior either way.
 * 
 * Usage: npx tsx scripts/relaunch.ts <zipPath> --md5=<hash> [--test] [--log=<path>]
 */

import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import AdmZip from "adm-zip";

const args = process.argv.slice(2);
const testMode = args.includes("--test");
const noNpmInstall = args.includes("--noNpmInstall");
const logArg = args.find(a => a.startsWith("--log="));
const md5Arg = args.find(a => a.startsWith("--md5="));
const portArg = args.find(a => a.startsWith("--port="));
const filteredArgs = args.filter(a => a !== "--test" && a !== "--noNpmInstall" && !a.startsWith("--log=") && !a.startsWith("--md5=") && !a.startsWith("--port="));
const zipPath = filteredArgs[0];
const statusPort = portArg ? parseInt(portArg.replace("--port=", ""), 10) : 80;

// Everything operates from cwd - no special knowledge of directory structure
const ROOT = process.cwd();

if (!zipPath) {
  console.error("Usage: npx tsx scripts/relaunch.ts <zipPath> --md5=<hash> [--test] [--noNpmInstall] [--log=<path>] [--port=<port>]");
  process.exit(1);
}

if (!md5Arg) {
  console.error("ERROR: --md5=<hash> is required for integrity verification");
  process.exit(1);
}
const expectedMd5: string = md5Arg.replace("--md5=", "");

const PID_FILE = path.join(ROOT, "server.pid");

// Use provided log file path, or generate a timestamped one
const LOG_FILE = logArg 
  ? logArg.replace("--log=", "")
  : path.join(ROOT, "dataDiagnostics", `relaunch-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);

function log(message: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] ${message}`;
  console.log(line);
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {
    // Ignore log write errors
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ============================================================================
// MINIMAL STATUS SERVER
// While relaunch is running, we serve our log file on the same port as the server
// so deploy.js can see what's happening. If relaunch fails catastrophically, we keep
// serving forever so the operator can diagnose remotely.
// Port is passed via --port=<port>, defaulting to 80 for production.
// ============================================================================

let statusServer: http.Server | null = null;

function startStatusServer(port: number = 80): Promise<void> {
  return new Promise((resolve, reject) => {
    statusServer = http.createServer((req, res) => {
      // Respond to /ping with 200 to keep AppRunner health checks happy
      if (req.url === "/ping") {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end("pong (relaunch in progress)");
      } else if (req.url?.startsWith("/admin/deploy-quick-status")) {
        // Serve our log file for monitoring
        res.writeHead(200, { "Content-Type": "text/plain" });
        try {
          const logContent = fs.readFileSync(LOG_FILE, "utf-8");
          res.end("[RELAUNCH]\n" + logContent);
        } catch {
          res.end("[RELAUNCH]\n[Log file not available yet]\n");
        }
      } else {
        // For any other request, return 503 with a helpful message
        res.writeHead(503, { "Content-Type": "text/plain" });
        res.end("[RELAUNCH]\nServer is restarting. Check /admin/deploy-quick-status for progress.\n");
      }
    });

    statusServer.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EACCES" || err.code === "EADDRINUSE") {
        log(`WARN: Could not start status server on port ${port}: ${err.code}`);
        statusServer = null;
        resolve(); // Don't fail the whole process, just continue without status server
      } else {
        reject(err);
      }
    });

    statusServer.listen(port, () => {
      log(`Status server listening on port ${port}`);
      resolve();
    });
  });
}

function stopStatusServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!statusServer) {
      resolve();
      return;
    }
    log("Stopping status server...");
    statusServer.close(() => {
      log("Status server stopped");
      statusServer = null;
      resolve();
    });
    // Force close after 2 seconds if connections are hanging
    setTimeout(() => {
      if (statusServer) {
        statusServer.closeAllConnections?.();
        statusServer = null;
      }
      resolve();
    }, 2000);
  });
}

/**
 * Launch the real server, handling status server lifecycle.
 * 
 * Flow:
 * 1. Stop status server (to free the port)
 * 2. Spawn real server
 * 3. If spawn succeeds, return true
 * 4. If spawn fails, restart status server and hang forever
 * 
 * Returns true if server launched successfully, never returns if it fails.
 */
async function launchServerWithRecovery(): Promise<boolean> {
  // Step 1: Stop status server to free the port
  await stopStatusServer();
  
  // Step 2: Try to spawn the real server
  try {
    log("Starting server...");
    // Use node directly instead of npm start - avoids shell requirement on Windows
    const serverProcess = spawn("node", ["server/dist/index.js"], {
      cwd: ROOT,
      detached: true,
      stdio: "ignore",
      env: process.env  // Explicitly inherit environment (includes TRAVELR_CONFIG)
    });
    serverProcess.unref();
    log(`Server started (PID ${serverProcess.pid})`);
    return true;
  } catch (err) {
    // Step 4: Spawn failed - restart status server and hang forever
    log(`CRITICAL: Failed to start server: ${err}`);
    log("Restarting status server for diagnostics...");
    
    await startStatusServer(statusPort);
    
    if (statusServer) {
      log(`Status server restarted on port ${statusPort}`);
      log("Query /api/admin/deploy-quick-status to see this log.");
      log("Waiting indefinitely... (Ctrl+C or kill to exit)");
      await new Promise(() => {}); // Never resolves
    }
    
    // If we couldn't restart status server either, just hang anyway
    log("Could not restart status server. Hanging to keep process visible...");
    await new Promise(() => {}); // Never resolves
    return false; // Never reached
  }
}

/**
 * Wait for the server to shut down by polling for PID file removal.
 * Also checks if the PID is still alive as a fallback.
 */
async function waitForServerShutdown(maxWaitMs: number = 30000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500;
  
  log("Waiting for server to shut down...");
  
  while (Date.now() - startTime < maxWaitMs) {
    // Check if PID file exists
    if (!fs.existsSync(PID_FILE)) {
      log("PID file removed - server has shut down");
      return true;
    }
    
    // Check if the process is still alive
    try {
      const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8").trim(), 10);
      process.kill(pid, 0); // Signal 0 = just check if process exists
      // Process still alive, keep waiting
    } catch {
      // Process doesn't exist, PID file is stale
      log("Server process no longer running");
      try {
        fs.unlinkSync(PID_FILE);
      } catch { /* ignore */ }
      return true;
    }
    
    await sleep(pollInterval);
  }
  
  log("Timeout waiting for server shutdown");
  return false;
}

interface ZipEntry {
  fileName: string;
  data: Buffer;
}

/**
 * Parse zip file using adm-zip and return array of file entries.
 * Validates MD5 checksum before parsing.
 * Does not write anything to disk - pure in-memory extraction.
 */
function parseZipInMemory(zipPath: string, expectedMd5: string): ZipEntry[] {
  const zipBuffer = fs.readFileSync(zipPath);
  
  // Verify MD5 checksum
  const actualMd5 = crypto.createHash("md5").update(zipBuffer).digest("hex");
  if (actualMd5 !== expectedMd5) {
    throw new Error(`MD5 checksum mismatch: expected ${expectedMd5}, got ${actualMd5}`);
  }
  log(`MD5 verified: ${actualMd5}`);
  
  const zip = new AdmZip(zipPath);
  const zipEntries = zip.getEntries();
  
  const entries: ZipEntry[] = [];
  for (const entry of zipEntries) {
    // Skip directories
    if (entry.isDirectory) continue;
    
    entries.push({
      fileName: entry.entryName,
      data: entry.getData()
    });
  }
  
  return entries;
}

/**
 * Write a file to disk, verifying the write succeeded.
 * Returns true if successful, false if failed.
 */
function writeFileVerified(filePath: string, data: Buffer): { ok: boolean; error?: string } {
  try {
    // Ensure parent directory exists
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    
    // Write the file
    fs.writeFileSync(filePath, data);
    
    // Verify by reading back and comparing size
    const stats = fs.statSync(filePath);
    if (stats.size !== data.length) {
      return { ok: false, error: `Size mismatch: wrote ${data.length}, got ${stats.size}` };
    }
    
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Check if package.json in zip differs from current.
 */
function packageJsonChangedInZip(entries: ZipEntry[]): boolean {
  const pkgEntry = entries.find(e => e.fileName === "package.json");
  if (!pkgEntry) return false;
  
  const oldPkgPath = path.join(ROOT, "package.json");
  if (!fs.existsSync(oldPkgPath)) return true;
  
  const oldPkg = fs.readFileSync(oldPkgPath, "utf-8");
  const newPkg = pkgEntry.data.toString("utf-8");
  
  return oldPkg !== newPkg;
}

async function main() {
  log("=".repeat(60));
  log(testMode ? "RELAUNCH SCRIPT TEST MODE" : "RELAUNCH SCRIPT STARTED");
  log(`Zip path: ${zipPath}`);
  log(`Root (cwd): ${ROOT}`);
  log("=".repeat(60));
  
  // Track whether we've started modifying the app directory.
  // If we fail BEFORE modifying files, restart is safe (code is unchanged).
  // If we fail AFTER modifying files, restart is NOT safe (code may be corrupt).
  let appDirectoryModified = false;
  
  try {
    // Step 1: Wait for server to shut down (always, even in test mode)
    const shutdown = await waitForServerShutdown(30000);
    if (!shutdown) {
      log("ERROR: Server did not shut down in time");
      process.exit(1);
    }
    
    // Give OS time to fully release the port after process exits
    log("Waiting for port to be released...");
    await sleep(2000);
    
    // Step 2: Start minimal status server so deploy.js can see our progress
    // Skip in test mode on Windows if port 80 (requires admin)
    if (testMode && statusPort === 80) {
      log("[TEST] Status server would start on port 80 now (requires admin)");
    } else {
      await startStatusServer(statusPort);
    }
    
    // Step 3: Parse zip in memory (no temp files), verify MD5
    // This throws on MD5 mismatch or corrupt zip - safe to restart after
    log("Parsing zip file in memory...");
    const entries = parseZipInMemory(zipPath, expectedMd5);
    log(`Found ${entries.length} files in zip`);
    
    // Step 4: Check if package.json changed (before we modify anything)
    const needsInstall = packageJsonChangedInZip(entries);
    log(`package.json changed: ${needsInstall}`);
    
    // Step 5: Write files to app directory
    // In test mode, just log what would be written
    if (testMode) {
      log("[TEST] Would deploy the following files:");
    } else {
      log("Writing files to app directory...");
      // ================================================================
      // POINT OF NO RETURN: After this, restart is NOT safe on failure
      // ================================================================
      appDirectoryModified = true;
    }
    
    let successCount = 0;
    let failCount = 0;
    
    for (const entry of entries) {
      const destPath = path.join(ROOT, entry.fileName);
      
      if (testMode) {
        log(`[TEST]   "${entry.fileName}" (${entry.data.length} bytes) -> "${destPath}" - NOT WRITTEN`);
        successCount++;
      } else {
        const result = writeFileVerified(destPath, entry.data);
        if (result.ok) {
          log(`  OK: ${entry.fileName}`);
          successCount++;
        } else {
          log(`  ERROR: ${entry.fileName} - ${result.error}`);
          failCount++;
        }
      }
    }
    
    log(`${testMode ? "[TEST] Would write" : "Wrote"} ${successCount} files, ${failCount} failed`);
    
    if (failCount > 0) {
      throw new Error(`${failCount} files failed to write - deployment incomplete`);
    }
    
    // Step 6: Run npm install if needed
    if (needsInstall) {
      if (testMode) {
        log("[TEST] Would run npm install");
      } else if (noNpmInstall) {
        log("[SKIP] npm install skipped (--noNpmInstall flag, protects junction-linked node_modules)");
      } else {
        log("Running npm install...");
        execSync("npm install", { cwd: ROOT, stdio: "inherit" });
      }
    }
    
    // Step 7: Build TypeScript
    if (testMode) {
      log("[TEST] Would run npm run build");
    } else {
      log("Building TypeScript...");
      execSync("npm run build", { cwd: ROOT, stdio: "inherit" });
    }
    
    // Step 8: Launch server
    // In test mode, we use launchServerWithRecovery too, but it won't have a status server to stop
    if (testMode) {
      log("[TEST] Status server would stop now");
    }
    await launchServerWithRecovery();
    
    log("=".repeat(60));
    log(testMode ? "[TEST] RELAUNCH COMPLETE - files NOT deployed, server restarted" : "RELAUNCH COMPLETE");
    log("=".repeat(60));
    
    // Clean up zip
    if (testMode) {
      log("[TEST] Cleaning up zip file");
    }
    try {
      fs.unlinkSync(zipPath);
    } catch {
      log("WARN: Could not delete zip file");
    }
    
  } catch (error) {
    log(`FATAL ERROR: ${error}`);
    
    if (appDirectoryModified) {
      // We've written files, run npm install, or run build.
      // The code on disk is in an unknown/corrupt state.
      // Starting the server could execute ANYTHING - do NOT restart.
      log("=".repeat(60));
      log("CRITICAL: App directory was modified before failure.");
      log("Code on disk may be corrupt or incomplete.");
      log("DO NOT restart server - manual intervention required.");
      log(`Status server will keep running on port ${statusPort} for diagnostics.`);
      log("Query /api/admin/deploy-quick-status to see this log.");
      log("=".repeat(60));
      
      // Keep the status server running forever so operator can diagnose
      // Do NOT exit - just hang here serving the log file
      if (statusServer) {
        log("Waiting indefinitely... (Ctrl+C or kill to exit)");
        await new Promise(() => {}); // Never resolves
      } else {
        // Status server wasn't started (test mode), just hang
        log("Hanging to keep process visible...");
        await new Promise(() => {}); // Never resolves
      }
    }
    
    // We failed BEFORE modifying the app directory (MD5 mismatch, corrupt zip, etc.)
    // The existing code is intact - safe to restart the server.
    log("App directory was not modified - safe to restart with existing code.");
    
    // Launch server with recovery (stops status server, spawns real server, hangs on failure)
    await launchServerWithRecovery();
    
    // If we get here, server was launched successfully
    log("Server restarted after safe failure.");
    process.exit(1); // Exit with error code since deploy-quick failed
  }
}

main();
