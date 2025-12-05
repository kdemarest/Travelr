/**
 * service-control.ts - High-level App Runner service control
 * 
 * Simple wrappers for stop/resume/status that use the ops config.
 */

import { opsConfig, type OpsConfig } from "./ops-config.js";
import {
  getServiceArn,
  getServiceStatus,
  getInProgressOperation,
  pauseService,
  resumeService,
  waitForOperation,
  type AppRunnerConfig,
  type AppRunnerServiceInfo
} from "./aws-apprunner.js";

// ============================================================================
// Types
// ============================================================================

export interface ServiceControlOptions {
  /** Custom config (if not provided, loads from jeesty-ops-config.json) */
  config?: OpsConfig;
  /** Logging function */
  log?: (message: string) => void;
  /** Wait for operation to complete */
  wait?: boolean;
}

export interface ServiceControlResult {
  ok: boolean;
  serviceArn?: string;
  error?: string;
}

export interface ServiceStatusResult extends AppRunnerServiceInfo {
  serviceName: string;
}

// ============================================================================
// Helpers
// ============================================================================

function getAppRunnerConfig(config: OpsConfig): AppRunnerConfig {
  return {
    region: config.aws.region,
    serviceName: config.name,
    port: config.container.port
  };
}

// ============================================================================
// Control Functions
// ============================================================================

/**
 * Stop (pause) the App Runner service.
 * This stops billing for compute while keeping the service configured.
 */
export function stopService(options: ServiceControlOptions = {}): ServiceControlResult {
  const config = options.config ?? opsConfig();
  const log = options.log ?? console.log;
  const arConfig = getAppRunnerConfig(config);

  log("Stopping App Runner service...");
  const result = pauseService(arConfig, log);

  if (result.ok && options.wait) {
    log("Waiting for stop to complete...");
    waitForOperation(arConfig, log);
  }

  return {
    ok: result.ok,
    serviceArn: result.serviceArn,
    error: result.error
  };
}

/**
 * Resume a paused App Runner service.
 */
export function startService(options: ServiceControlOptions = {}): ServiceControlResult {
  const config = options.config ?? opsConfig();
  const log = options.log ?? console.log;
  const arConfig = getAppRunnerConfig(config);

  log("Resuming App Runner service...");
  const result = resumeService(arConfig, log);

  if (result.ok && options.wait) {
    log("Waiting for resume to complete...");
    waitForOperation(arConfig, log);
  }

  return {
    ok: result.ok,
    serviceArn: result.serviceArn,
    error: result.error
  };
}

/**
 * Format elapsed time as MM:SS
 */
function formatElapsed(startTime: string): string {
  const start = new Date(startTime).getTime();
  const now = Date.now();
  const elapsedMs = now - start;
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}

/**
 * Get the current status of the App Runner service.
 * 
 * Line 1: Service name and URL (if known)
 * Line 2: Status with elapsed time if operation in progress
 * 
 * If wait=true and operation is in progress, polls every 10 seconds until complete.
 */
export function getStatus(options: ServiceControlOptions = {}): ServiceStatusResult & { message: string } {
  const config = options.config ?? opsConfig();
  const log = options.log ?? console.log;
  const wait = options.wait ?? false;
  const arConfig = getAppRunnerConfig(config);

  const info = getServiceStatus(arConfig);
  
  // Line 1: Service and URL
  const urlPart = info.url ? ` - ${info.url}` : "";
  const line1 = `${config.name}${urlPart}`;
  log(line1);

  // Function to print status line (line 2)
  const printStatus = (clearLine: boolean = false): boolean => {
    const currentInfo = getServiceStatus(arConfig);
    const isInProgress = currentInfo.status === "OPERATION_IN_PROGRESS";
    
    let statusLine: string;
    if (isInProgress && currentInfo.arn) {
      const opInfo = getInProgressOperation(currentInfo.arn, arConfig.region);
      if (opInfo && opInfo.startedAt) {
        const elapsed = formatElapsed(opInfo.startedAt);
        statusLine = `${elapsed} ${currentInfo.status} (${opInfo.type})`;
      } else {
        statusLine = `00:00 ${currentInfo.status}`;
      }
    } else {
      statusLine = currentInfo.status;
    }

    if (clearLine) {
      // Use carriage return to overwrite the line
      process.stdout.write(`\r${statusLine.padEnd(60)}`);
    } else {
      log(statusLine);
    }
    
    return isInProgress;
  };

  // Print initial status
  let isInProgress = printStatus(false);

  // If wait mode and operation in progress, poll until done
  if (wait && isInProgress) {
    const sleep = (ms: number) => {
      const end = Date.now() + ms;
      while (Date.now() < end) { /* busy wait */ }
    };

    while (isInProgress) {
      sleep(10000);
      isInProgress = printStatus(true);
    }
    // Final newline after polling completes
    console.log();
  }

  return {
    serviceName: config.name,
    ...info,
    message: "" // Already logged directly
  };
}

/**
 * Wait for any in-progress operation to complete.
 */
export function waitForService(options: Omit<ServiceControlOptions, "wait"> = {}): { ok: boolean; finalStatus: string } {
  const config = options.config ?? opsConfig();
  const log = options.log ?? console.log;
  const arConfig = getAppRunnerConfig(config);

  return waitForOperation(arConfig, log);
}
