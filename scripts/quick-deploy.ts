/**
 * quick-deploy.ts - Core quick-deploy deployment logic
 * 
 * This module provides the shared quick-deploy functionality used by:
 * - deploy.js --quick (production deploys)
 * - test-deploy-quick.ts (local testing)
 * - Direct CLI: npx tsx scripts/quick-deploy.ts -prod
 * 
 * It handles:
 * 1. Creating the deployment zip
 * 2. Authenticating as deploybot
 * 3. POSTing the zip to /admin/deploy-quick
 * 4. Waiting for server to restart (polling status endpoint)
 * 
 * CLI Usage:
 *   npx tsx scripts/quick-deploy.ts -prod              # Deploy to production (auto-detects URL)
 *   npx tsx scripts/quick-deploy.ts <serverUrl>        # Deploy to explicit URL
 * 
 * Requires TRAVELR_DEPLOYBOT_PWD environment variable.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createDeploymentZip } from "./create-quick-deploy-zip.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface QuickDeployOptions {
  /** Base URL of the target server (e.g., "http://localhost:4000" or "https://xxx.awsapprunner.com") */
  serverUrl: string;
  /** Deploybot password */
  password: string;
  /** Device ID for auth (default: "quick-deploy") */
  deviceId?: string;
  /** Source root to zip (default: process.cwd()) */
  sourceRoot?: string;
  /** Callback for log messages */
  log?: (message: string) => void;
  /** Callback for progress updates during wait */
  onProgress?: (elapsedSec: number, status?: string) => void;
  /** Max time to wait for server restart in ms (default: 60000) */
  maxWaitMs?: number;
}

export interface QuickDeployResult {
  ok: boolean;
  error?: string;
  zipSize?: number;
  fileCount?: number;
  relaunchPid?: number;
  logFile?: string;
  restartTimeMs?: number;
}

/**
 * Authenticate as deploybot and get an authKey.
 */
async function authenticate(
  serverUrl: string,
  password: string,
  deviceId: string
): Promise<string> {
  const response = await fetch(`${serverUrl}/auth`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user: "deploybot", password, deviceId })
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Authentication failed: ${response.status} - ${text}`);
  }
  
  const data = await response.json() as { ok?: boolean; authKey?: string; error?: string };
  if (!data.ok || !data.authKey) {
    throw new Error(`No authKey in auth response: ${data.error || "unknown error"}`);
  }
  
  return data.authKey;
}

/**
 * Wait for server to come back up after deploy-quick.
 * Polls /ping and optionally /admin/deploy-quick-status for progress.
 */
async function waitForServer(
  serverUrl: string,
  authKey: string,
  deviceId: string,
  maxWaitMs: number,
  onProgress?: (elapsedSec: number, status?: string) => void
): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 2000;
  let seenLineCount = 0;
  
  while (Date.now() - startTime < maxWaitMs) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    // Try to get status from relaunch.ts status server (runs on same port during restart)
    try {
      const statusResp = await fetch(`${serverUrl}/admin/deploy-quick-status`, {
        headers: {
          "x-auth-user": "deploybot",
          "x-auth-device": deviceId,
          "x-auth-key": authKey
        },
        signal: AbortSignal.timeout(2000)
      });
      if (statusResp.ok) {
        const statusText = await statusResp.text();
        // Filter out empty lines and [RELAUNCH]/[SERVER] prefix lines
        const lines = statusText.split("\n").filter(l => 
          l.trim() && !l.startsWith("[RELAUNCH]") && !l.startsWith("[SERVER]")
        );
        // Report new lines as progress
        const newLines = lines.slice(seenLineCount);
        for (const line of newLines) {
          onProgress?.(elapsed, line);
        }
        seenLineCount = lines.length;
      }
    } catch {
      // Connection refused, timeout, etc. - server is down, which is expected
    }
    
    // Check if server is fully up via /ping
    try {
      const response = await fetch(`${serverUrl}/ping`, {
        signal: AbortSignal.timeout(2000)
      });
      if (response.ok) {
        const text = await response.text();
        if (text.trim() === "pong") {
          return true;
        }
      }
    } catch {
      // Server not ready yet - expected during restart
    }
    
    onProgress?.(elapsed, undefined);
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  return false;
}

/**
 * Perform a quick-deploy deployment to the target server.
 */
export async function quickDeploy(options: QuickDeployOptions): Promise<QuickDeployResult> {
  const {
    serverUrl,
    password,
    deviceId = "quick-deploy",
    sourceRoot = process.cwd(),
    log = console.log,
    onProgress,
    maxWaitMs = 60000
  } = options;
  
  try {
    // Step 1: Authenticate
    log("Authenticating as deploybot...");
    const authKey = await authenticate(serverUrl, password, deviceId);
    log("Authenticated");
    
    // Step 2: Create deployment zip
    log("Creating deployment zip...");
    const zipPath = await createDeploymentZip(sourceRoot);
    const zipStats = fs.statSync(zipPath);
    const zipSize = zipStats.size;
    log(`Created ${(zipSize / 1024).toFixed(1)} KB zip`);
    
    // Step 3: POST to deploy-quick endpoint
    log("Sending zip to /admin/deploy-quick...");
    const zipBuffer = fs.readFileSync(zipPath);
    const zipMd5 = crypto.createHash("md5").update(zipBuffer).digest("hex");
    log(`Zip MD5: ${zipMd5}`);
    
    const deployQuickResp = await fetch(`${serverUrl}/admin/deploy-quick`, {
      method: "POST",
      headers: {
        "x-auth-user": "deploybot",
        "x-auth-device": deviceId,
        "x-auth-key": authKey,
        "Content-Type": "application/octet-stream",
        "X-Content-MD5": zipMd5
      },
      body: zipBuffer
    });
    
    // Clean up zip file
    try {
      fs.unlinkSync(zipPath);
    } catch {
      // Ignore cleanup errors
    }
    
    if (!deployQuickResp.ok) {
      const text = await deployQuickResp.text();
      return { ok: false, error: `Deploy quick request failed: ${deployQuickResp.status} - ${text}` };
    }
    
    const result = await deployQuickResp.json() as { 
      ok: boolean; 
      logFile?: string;
      fileCount?: number;
      relaunchPid?: number;
      message?: string;
      error?: string;
    };
    
    if (!result.ok) {
      return { ok: false, error: result.error || result.message || "Deploy quick failed" };
    }
    
    log(`Server accepted: ${result.fileCount} files validated`);
    if (result.relaunchPid) {
      log(`Relaunch process started (PID ${result.relaunchPid})`);
    }
    if (result.logFile) {
      log(`Log file: ${result.logFile}`);
    }
    
    // Step 4: Wait for server to restart
    log("Waiting for server to restart...");
    const waitStart = Date.now();
    
    // Need to re-authenticate after restart since it's a new server instance
    // But first wait for the server to come back up
    await new Promise(resolve => setTimeout(resolve, 1000)); // Give server time to start shutdown
    
    const serverBack = await waitForServer(serverUrl, authKey, deviceId, maxWaitMs, onProgress);
    const restartTimeMs = Date.now() - waitStart;
    
    if (!serverBack) {
      return { 
        ok: false, 
        error: `Server did not come back up within ${maxWaitMs / 1000} seconds`,
        zipSize,
        fileCount: result.fileCount,
        relaunchPid: result.relaunchPid,
        logFile: result.logFile
      };
    }
    
    log(`Server is back up after ${Math.round(restartTimeMs / 1000)}s`);
    
    return {
      ok: true,
      zipSize,
      fileCount: result.fileCount,
      relaunchPid: result.relaunchPid,
      logFile: result.logFile,
      restartTimeMs
    };
    
  } catch (error) {
    return { 
      ok: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}

/**
 * Get the production server URL from AWS AppRunner.
 */
function getProductionUrl(): string | null {
  const awsRegion = "us-east-1";  // TODO: Could read from deploy config
  const serviceName = "travelr";  // TODO: Could read from deploy config
  
  try {
    const cmd = `aws apprunner list-services --region ${awsRegion} --query "ServiceSummaryList[?ServiceName=='${serviceName}'].ServiceUrl" --output text`;
    const result = execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] }).trim();
    
    if (!result || result === "None" || result.length === 0) {
      return null;
    }
    
    return `https://${result}`;
  } catch {
    return null;
  }
}

function showUsage(): void {
  console.log(`
quick-deploy.ts - Quick deploy tool

Usage:
  npx tsx scripts/quick-deploy.ts -prod              Deploy to production (auto-detects URL from AWS)
  npx tsx scripts/quick-deploy.ts <serverUrl>        Deploy to a specific server URL

Environment Variables:
  TRAVELR_DEPLOYBOT_PWD    Required for deployment

Examples:
  npx tsx scripts/quick-deploy.ts -prod
  npx tsx scripts/quick-deploy.ts https://myserver.awsapprunner.com

To run the test harness:
  npx tsx tests/test-deploy-quick.ts
`);
}

/**
 * CLI entry point - can be run directly for quick deploys.
 */
async function main() {
  const arg = process.argv[2];
  
  // No argument - show usage
  if (!arg) {
    showUsage();
    process.exit(0);
  }
  
  // -prod: Auto-detect production URL from AWS
  let serverUrl: string;
  if (arg === "-prod") {
    console.log("Detecting production server URL from AWS...");
    const prodUrl = getProductionUrl();
    if (!prodUrl) {
      console.error("Error: Could not detect production URL from AWS AppRunner");
      console.error("Make sure you have AWS CLI configured and the service is running.");
      process.exit(1);
    }
    serverUrl = prodUrl;
    console.log(`Found: ${serverUrl}\n`);
  } else {
    // Explicit URL provided
    serverUrl = arg;
  }
  
  // Check for password
  const password = process.env.TRAVELR_DEPLOYBOT_PWD;
  if (!password) {
    console.error("Error: TRAVELR_DEPLOYBOT_PWD environment variable not set");
    process.exit(1);
  }
  
  console.log(`Quick deploy to: ${serverUrl}\n`);
  
  const result = await quickDeploy({
    serverUrl,
    password,
    log: console.log,
    onProgress: (elapsed, status) => {
      if (status) {
        console.log(`  ${elapsed}s - ${status}`);
      } else {
        console.log(`  ${elapsed}s - waiting...`);
      }
    }
  });
  
  if (result.ok) {
    console.log("\n✓ Quick deploy complete!");
    process.exit(0);
  } else {
    console.error(`\n✗ Quick deploy failed: ${result.error}`);
    process.exit(1);
  }
}

// Run if executed directly
const isMain = process.argv[1]?.endsWith("quick-deploy.ts") || process.argv[1]?.endsWith("quick-deploy.js");
if (isMain) {
  main();
}
