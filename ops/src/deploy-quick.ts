/**
 * deploy-quick.ts - Quick deploy implementation
 * 
 * Deploys code changes without rebuilding the Docker image.
 * Creates a zip of source files, uploads to the running server,
 * which extracts, rebuilds, and restarts.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { opsConfig, getProductionUrl, type OpsConfig } from "./ops-config.js";
import { createDeployableZip } from "./create-deployable-zip.js";

// ============================================================================
// Types
// ============================================================================

export interface DeployQuickOptions {
  /** Target server URL. If not provided, gets production URL from AWS */
  target?: string;
  /** Use local dev server (http://localhost:<port>) */
  local?: boolean;
  /** Dry run - do everything except write files and restart */
  dryRun?: boolean;
  /** Custom config (if not provided, loads from jeesty-ops-config.json) */
  config?: OpsConfig;
  /** Logging function */
  log?: (message: string) => void;
  /** Password (if not provided, reads from env var in config) */
  password?: string;
  /** Device ID for auth */
  deviceId?: string;
}

export interface DeployQuickResult {
  ok: boolean;
  error?: string;
  fileCount?: number;
  logFile?: string;
  restartTimeMs?: number;
}

// ============================================================================
// Authentication
// ============================================================================

async function authenticate(
  baseUrl: string, 
  config: OpsConfig,
  log: (msg: string) => void,
  passwordOverride?: string,
  deviceId?: string
): Promise<string> {
  const password = passwordOverride ?? process.env[config.auth.passwordEnvVar];
  
  if (!password) {
    throw new Error(`${config.auth.passwordEnvVar} environment variable not set`);
  }
  
  log("Authenticating as " + config.auth.user + "...");
  
  const response = await fetch(`${baseUrl}${config.auth.endpoint}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      user: config.auth.user,
      password: password,
      deviceId: deviceId ?? "device-jeesty-ops"
    })
  });
  
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Login failed: ${response.status} - ${text}`);
  }
  
  const data = await response.json() as { ok: boolean; authKey?: string; error?: string };
  if (!data.ok || !data.authKey) {
    throw new Error(`Login failed: ${data.error || "No authKey returned"}`);
  }
  
  log("Authenticated");
  return data.authKey;
}

// ============================================================================
// Wait for Restart
// ============================================================================

async function waitForRestart(
  baseUrl: string,
  config: OpsConfig,
  log: (msg: string) => void
): Promise<number> {
  const maxWaitMs = 120000; // 2 minutes
  const pollInterval = 2000; // 2 seconds
  const startTime = Date.now();
  
  log("Waiting for server to restart...");
  
  // Brief pause for server to begin shutdown
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  while (Date.now() - startTime < maxWaitMs) {
    const elapsed = Math.round((Date.now() - startTime) / 1000);
    
    try {
      const response = await fetch(`${baseUrl}${config.container.healthCheck.path}`, {
        signal: AbortSignal.timeout(3000)
      });
      
      if (response.ok) {
        const text = await response.text();
        if (text.trim() === config.container.healthCheck.expected) {
          log(`Server is back up after ${elapsed}s`);
          return Date.now() - startTime;
        }
      }
    } catch {
      // Server not ready yet
    }
    
    log(`  ${elapsed}s - waiting...`);
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  
  throw new Error("Timeout waiting for server to restart");
}

// ============================================================================
// Main Export
// ============================================================================

/**
 * Deploy code changes via quick deploy.
 * 
 * @param options - Deployment options
 * @returns Result of the deployment
 */
export async function deployQuick(options: DeployQuickOptions = {}): Promise<DeployQuickResult> {
  const config = options.config ?? opsConfig();
  const log = options.log ?? console.log;
  const dryRun = options.dryRun ?? false;
  
  try {
    // Determine target URL
    let baseUrl: string;
    if (options.target) {
      baseUrl = options.target;
    } else if (options.local) {
      baseUrl = `http://localhost:${config.container.port}`;
    } else {
      log("Detecting production server URL from AWS...");
      baseUrl = await getProductionUrl(config);
      log(`Found: ${baseUrl}`);
    }
    
    log(`\nQuick deploy to: ${baseUrl}\n`);
    
    // Step 1: Authenticate
    const authKey = await authenticate(baseUrl, config, log, options.password, options.deviceId);
    
    // Step 2: Create zip
    log("Creating deployment zip...");
    const zipPath = await createDeployableZip({
      projectRoot: config.projectRoot,
      include: config.deployQuick.include,
      exclude: config.deployQuick.exclude,
      outputPath: path.join(config.projectRoot, "dataTemp", "quick-deploy-outbound.zip")
    });
    const zipBuffer = fs.readFileSync(zipPath);
    const zipMd5 = crypto.createHash("md5").update(zipBuffer).digest("hex");
    log(`Created ${(zipBuffer.length / 1024).toFixed(1)} KB zip`);
    
    // Step 3: Upload
    const endpoint = dryRun 
      ? `${config.deployQuick.endpoint}?dryRun=true`
      : config.deployQuick.endpoint;
    log(`Sending zip to ${endpoint}...`);
    log(`Zip MD5: ${zipMd5}`);
    
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "X-Content-MD5": zipMd5,
        "x-auth-user": config.auth.user,
        "x-auth-device": options.deviceId ?? "device-jeesty-ops",
        "x-auth-key": authKey
      },
      body: zipBuffer
    });
    
    // Clean up zip
    try { fs.unlinkSync(zipPath); } catch { /* ignore */ }
    
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Deploy quick request failed: ${response.status} - ${text}`);
    }
    
    const data = await response.json() as { 
      ok: boolean; 
      error?: string; 
      fileCount?: number;
      logFile?: string;
    };
    
    if (!data.ok) {
      throw new Error(`Deploy quick failed: ${data.error}`);
    }
    
    log(`Server accepted: ${data.fileCount} files validated`);
    if (data.logFile) {
      log(`Log file: ${data.logFile}`);
    }
    
    // Step 4: Wait for restart
    const restartTimeMs = await waitForRestart(baseUrl, config, log);
    
    log("\n✓ Quick deploy complete!");
    
    return {
      ok: true,
      fileCount: data.fileCount,
      logFile: data.logFile,
      restartTimeMs
    };
    
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`\n✗ Quick deploy failed: ${message}`);
    return {
      ok: false,
      error: message
    };
  }
}
