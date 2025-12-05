/**
 * deploy-quick.ts - Quick deploy implementation
 * 
 * The server stays running while we:
 * 1. Extract files from zip (Node doesn't lock source files)
 * 2. Run npm install if package.json changed
 * 3. Run npm run build
 * 4. Exit with code 99 (signals server-runner to restart)
 * 
 * This keeps health checks happy the whole time since Express keeps responding.
 * The server-runner.ts process manager handles the actual restart.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import AdmZip from "adm-zip";
import { Paths } from "./data-paths.js";
import { removePidFile } from "./pid-file.js";

export interface DeployQuickOptions {
  zipBuffer: Buffer;
  expectedMd5: string;
  testMode?: boolean;
  dryRun?: boolean;      // Do everything except copy files and restart
  skipNpmInstall?: boolean;
}

export interface DeployQuickResult {
  ok: boolean;
  error?: string;
  fileCount?: number;
  message?: string;
  logFile?: string;
}

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
function packageJsonChanged(entries: AdmZip.IZipEntry[]): boolean {
  const pkgEntry = entries.find(e => e.entryName === "package.json");
  if (!pkgEntry) return false;
  
  const oldPkgPath = path.join(Paths.dataRoot, "package.json");
  if (!fs.existsSync(oldPkgPath)) return true;
  
  const oldPkg = fs.readFileSync(oldPkgPath, "utf-8");
  const newPkg = pkgEntry.getData().toString("utf-8");
  
  return oldPkg !== newPkg;
}

/**
 * Perform quick deploy: extract files, install, build, restart.
 * Server stays running until the very end.
 */
export async function performDeployQuick(options: DeployQuickOptions): Promise<DeployQuickResult> {
  const { zipBuffer, expectedMd5, testMode = false, dryRun = false, skipNpmInstall = false } = options;
  const ROOT = Paths.dataRoot;
  const logs: string[] = [];
  
  function log(msg: string) {
    const line = `[${new Date().toISOString()}] ${msg}`;
    console.log("[DeployQuick]", msg);
    logs.push(line);
  }
  
  // Create log file
  const logTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const diagnosticsDir = Paths.dataDiagnostics;
  if (!fs.existsSync(diagnosticsDir)) {
    fs.mkdirSync(diagnosticsDir, { recursive: true });
  }
  const logFile = path.join(diagnosticsDir, `deploy-quick-${logTimestamp}.log`);
  
  function saveLog() {
    try {
      fs.writeFileSync(logFile, logs.join("\n") + "\n");
    } catch { /* ignore */ }
  }
  
  try {
    log("=".repeat(60));
    log(`DEPLOY QUICK STARTED${dryRun ? " (DRY RUN)" : ""}`);
    log(`Root: ${ROOT}`);
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
    const needsInstall = packageJsonChanged(entries);
    log(`package.json changed: ${needsInstall}`);
    
    // Step 4: Extract files
    log("Extracting files...");
    let successCount = 0;
    let failCount = 0;
    
    for (const entry of entries) {
      const destPath = path.join(ROOT, entry.entryName);
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
        execSync("npm install", { cwd: ROOT, stdio: "pipe" });
        log("npm install complete");
      }
    }
    
    // Step 6: Build TypeScript
    log("Building TypeScript...");
    execSync("npm run build", { cwd: ROOT, stdio: "pipe" });
    log("Build complete");
    
    // Step 7: Signal restart by exiting with code 99
    // server-runner.ts watches for this and restarts the server
    log("Signaling restart (exit code 99)...");
    
    log("=".repeat(60));
    log(`DEPLOY QUICK COMPLETE${dryRun ? " (DRY RUN - NO RESTART)" : " - RESTARTING"}`);
    log("=".repeat(60));
    
    saveLog();
    
    // Exit with code 99 to signal server-runner to restart us
    // In dry-run or test mode, don't exit
    if (!testMode && !dryRun) {
      setTimeout(() => {
        console.log("[DeployQuick] Exiting for restart (code 99)...");
        removePidFile();
        process.exit(99);
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
