/**
 * deploy-quick-handler.ts - Server-side handler for quick deploy
 * 
 * This is the handler that runs ON the server when it receives a deploy-quick request.
 * It extracts files from the zip, runs npm install/build, and signals restart.
 * 
 * Designed to be dependency-free from server internals - all paths and callbacks
 * are passed in by the caller.
 * 
 * The server stays running while we:
 * 1. Extract files from zip (Node doesn't lock source files)
 * 2. Run npm install if package.json changed
 * 3. Run npm run build
 * 4. Call triggerRestart() to signal server-runner to restart
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import AdmZip from "adm-zip";

// ============================================================================
// Types
// ============================================================================

export interface DeployQuickHandlerOptions {
  /** The zip file contents */
  zipBuffer: Buffer;
  /** Expected MD5 hash of the zip */
  expectedMd5: string;
  /** Root directory where files should be extracted */
  dataRoot: string;
  /** Directory for writing log files */
  diagnosticsDir: string;
  /** Callback to trigger server restart (e.g., removePidFile + process.exit(99)) */
  triggerRestart: () => void;
  /** Test mode - don't actually restart */
  testMode?: boolean;
  /** Dry run - do everything except copy files and restart */
  dryRun?: boolean;
  /** Skip npm install even if package.json changed */
  skipNpmInstall?: boolean;
}

export interface DeployQuickHandlerResult {
  ok: boolean;
  error?: string;
  fileCount?: number;
  message?: string;
  logFile?: string;
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Write a file to disk, creating parent directories as needed.
 */
function writeFileVerified(filePath: string, data: Buffer): { ok: boolean; error?: string } {
  try {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, data);
    
    // Verify by checking size
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
function packageJsonChanged(entries: AdmZip.IZipEntry[], dataRoot: string): boolean {
  const pkgEntry = entries.find(e => e.entryName === "package.json");
  if (!pkgEntry) return false;
  
  const oldPkgPath = path.join(dataRoot, "package.json");
  if (!fs.existsSync(oldPkgPath)) return true;
  
  const oldPkg = fs.readFileSync(oldPkgPath, "utf-8");
  const newPkg = pkgEntry.getData().toString("utf-8");
  
  return oldPkg !== newPkg;
}

// ============================================================================
// Main Handler
// ============================================================================

/**
 * Handle a deploy-quick request: extract files, install, build, restart.
 * Server stays running until the very end when triggerRestart() is called.
 */
export async function handleDeployQuick(options: DeployQuickHandlerOptions): Promise<DeployQuickHandlerResult> {
  const { 
    zipBuffer, 
    expectedMd5, 
    dataRoot, 
    diagnosticsDir,
    triggerRestart,
    testMode = false, 
    dryRun = false, 
    skipNpmInstall = false 
  } = options;
  
  const logs: string[] = [];
  
  function log(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log("[DeployQuick]", msg);
    logs.push(line);
  }
  
  // Ensure diagnostics directory exists
  if (!fs.existsSync(diagnosticsDir)) {
    fs.mkdirSync(diagnosticsDir, { recursive: true });
  }
  
  // Create log file
  const logTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logFile = path.join(diagnosticsDir, `deploy-quick-${logTimestamp}.log`);
  
  function saveLog() {
    try {
      fs.writeFileSync(logFile, logs.join("\n") + "\n");
    } catch { /* ignore */ }
  }
  
  try {
    log("=".repeat(60));
    log(`DEPLOY QUICK STARTED${dryRun ? " (DRY RUN)" : ""}`);
    log(`Root: ${dataRoot}`);
    log("=".repeat(60));
    
    // Step 1: Verify MD5
    const actualMd5 = crypto.createHash("md5").update(zipBuffer).digest("hex");
    if (actualMd5 !== expectedMd5) {
      throw new Error(`MD5 mismatch: expected ${expectedMd5}, got ${actualMd5}`);
    }
    log(`MD5 verified: ${actualMd5}`);
    
    // Step 2: Parse zip
    log("Parsing zip...");
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries().filter(e => !e.isDirectory);
    log(`Found ${entries.length} files`);
    
    // Step 3: Check if npm install needed (before modifying files)
    const needsInstall = packageJsonChanged(entries, dataRoot);
    log(`package.json changed: ${needsInstall}`);
    
    // Step 4: Extract files
    log("Extracting files...");
    let successCount = 0;
    let failCount = 0;
    
    for (const entry of entries) {
      const destPath = path.join(dataRoot, entry.entryName);
      if (dryRun) {
        log(`  [DRY RUN] Would write: ${entry.entryName}`);
        successCount++;
      } else {
        const result = writeFileVerified(destPath, entry.getData());
        if (result.ok) {
          successCount++;
        } else {
          log(`  ERROR: ${entry.entryName} - ${result.error}`);
          failCount++;
        }
      }
    }
    
    log(`Extracted ${successCount} files, ${failCount} failed`);
    
    if (failCount > 0) {
      throw new Error(`${failCount} files failed to extract`);
    }
    
    // Step 5: npm install if needed
    if (needsInstall) {
      if (skipNpmInstall) {
        log("[SKIP] npm install (skipNpmInstall flag)");
      } else {
        log("Running npm install...");
        execSync("npm install", { cwd: dataRoot, stdio: "pipe" });
        log("npm install complete");
      }
    }
    
    // Step 6: Build TypeScript
    log("Building TypeScript...");
    execSync("npm run build", { cwd: dataRoot, stdio: "pipe" });
    log("Build complete");
    
    // Step 7: Signal restart
    log("Signaling restart...");
    
    log("=".repeat(60));
    log(`DEPLOY QUICK COMPLETE${dryRun ? " (DRY RUN - NO RESTART)" : " - RESTARTING"}`);
    log("=".repeat(60));
    
    saveLog();
    
    // Trigger restart unless in dry-run or test mode
    if (!testMode && !dryRun) {
      setTimeout(() => {
        console.log("[DeployQuick] Triggering restart...");
        triggerRestart();
      }, 500);
    }
    
    return {
      ok: true,
      fileCount: entries.length,
      message: dryRun 
        ? "Deploy quick dry run complete (no files changed, no restart)"
        : "Deploy quick complete, server restarting",
      logFile
    };
    
  } catch (error) {
    log(`FATAL ERROR: ${error}`);
    saveLog();
    return {
      ok: false,
      error: String(error),
      logFile
    };
  }
}
