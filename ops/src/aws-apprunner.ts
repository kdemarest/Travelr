/**
 * aws-apprunner.ts - AWS App Runner operations
 * 
 * Create, update, pause, resume, and monitor App Runner services.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { ensureAppRunnerAccessRole } from "./aws-s3-iam.js";

// ============================================================================
// Types
// ============================================================================

export interface AppRunnerConfig {
  /** AWS region (e.g., "us-east-1") */
  region: string;
  /** App Runner service name */
  serviceName: string;
  /** Container port */
  port: number;
  /** Environment variables to pass to the container */
  envVars?: Record<string, string>;
  /** S3 bucket name (added to env vars) */
  s3Bucket?: string;
  /** Instance role ARN for S3 access */
  instanceRoleArn?: string;
}

export interface AppRunnerServiceInfo {
  arn: string | null;
  status: string;
  url: string | null;
  updatedAt?: string;
}

export interface AppRunnerOperationInfo {
  type: string;
  id: string | null;
  startedAt: string | null;
}

export interface AppRunnerDeployResult {
  ok: boolean;
  serviceArn?: string;
  serviceUrl?: string;
  error?: string;
}

export interface AppRunnerControlResult {
  ok: boolean;
  action: "pause" | "resume" | "delete";
  serviceArn?: string;
  error?: string;
}

// ============================================================================
// Helpers
// ============================================================================

function execWithOutput(cmd: string, options?: { ignoreError?: boolean }): string | null {
  try {
    return execSync(cmd, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
  } catch (error) {
    if (options?.ignoreError) return null;
    throw error;
  }
}

function exec(cmd: string): void {
  execSync(cmd, { stdio: "inherit" });
}

function sleep(ms: number): void {
  execSync(`node -e "setTimeout(() => {}, ${ms})"`, { stdio: "ignore" });
}

// ============================================================================
// Service Discovery
// ============================================================================

/**
 * Get the ARN of an App Runner service by name.
 */
export function getServiceArn(config: AppRunnerConfig): string | null {
  const cmd = `aws apprunner list-services --region ${config.region} --query "ServiceSummaryList[?ServiceName=='${config.serviceName}'].ServiceArn" --output text`;
  const arn = execWithOutput(cmd, { ignoreError: true });
  if (!arn || arn === "None" || !arn.trim()) {
    return null;
  }
  return arn.trim();
}

/**
 * Get details about the current in-progress operation (if any).
 */
export function getInProgressOperation(
  serviceArn: string,
  region: string
): AppRunnerOperationInfo | null {
  try {
    const cmd = `aws apprunner list-operations --service-arn ${serviceArn} --region ${region} --max-results 5 --output json`;
    const raw = execWithOutput(cmd, { ignoreError: true });
    if (!raw) return null;
    
    const parsed = JSON.parse(raw) as { OperationSummaryList?: Array<{
      Status?: string;
      Type?: string;
      Id?: string;
      StartedAt?: string;
    }> };
    const ops = parsed.OperationSummaryList ?? [];
    const inProgress = ops.find(op => op.Status === "IN_PROGRESS");
    
    if (inProgress) {
      return {
        type: inProgress.Type ?? "UNKNOWN",
        id: inProgress.Id ?? null,
        startedAt: inProgress.StartedAt ?? null
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get the latest operation for a service.
 */
export function getLatestOperation(
  serviceArn: string,
  region: string
): { type: string; status: string; startedAt: string; endedAt?: string } | null {
  try {
    const cmd = `aws apprunner list-operations --service-arn ${serviceArn} --region ${region} --max-results 1 --output json`;
    const raw = execWithOutput(cmd, { ignoreError: true });
    if (!raw) return null;
    
    const parsed = JSON.parse(raw) as { OperationSummaryList?: Array<{
      Status?: string;
      Type?: string;
      StartedAt?: string;
      EndedAt?: string;
    }> };
    const ops = parsed.OperationSummaryList ?? [];
    const latest = ops[0];
    
    if (latest) {
      return {
        type: latest.Type ?? "UNKNOWN",
        status: latest.Status ?? "UNKNOWN",
        startedAt: latest.StartedAt ?? "",
        endedAt: latest.EndedAt
      };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Get current status and info about an App Runner service.
 */
export function getServiceStatus(config: AppRunnerConfig): AppRunnerServiceInfo {
  const arn = getServiceArn(config);
  if (!arn) {
    return { arn: null, status: "NOT_FOUND", url: null };
  }

  const cmd = `aws apprunner describe-service --service-arn ${arn} --region ${config.region} --output json`;
  const raw = execWithOutput(cmd, { ignoreError: true });
  
  if (!raw) {
    return { arn, status: "UNKNOWN", url: null };
  }

  const parsed = JSON.parse(raw) as { Service?: {
    Status?: string;
    ServiceUrl?: string;
    UpdatedAt?: string;
  } };
  const service = parsed.Service ?? {};

  return {
    arn,
    status: service.Status ?? "UNKNOWN",
    url: service.ServiceUrl ? `https://${service.ServiceUrl}` : null,
    updatedAt: service.UpdatedAt
  };
}

// ============================================================================
// Retry Logic
// ============================================================================

/**
 * Retry a command when an operation is in progress.
 */
function retryOnOperationInProgress(
  cmd: string,
  config: AppRunnerConfig,
  log: (msg: string) => void
): void {
  let attempt = 1;

  while (true) {
    try {
      exec(cmd);
      return;
    } catch (error) {
      const message = (error as Error).message || "";

      if (message.includes("OPERATION_IN_PROGRESS") || message.includes("InvalidStateException")) {
        if (attempt === 1) {
          const serviceArn = getServiceArn(config);
          if (serviceArn) {
            const opInfo = getInProgressOperation(serviceArn, config.region);
            if (opInfo) {
              const startedLabel = opInfo.startedAt ? ` (started ${opInfo.startedAt})` : "";
              log(`Service has operation in progress: ${opInfo.type}${startedLabel}`);
            } else {
              log("Service has an operation in progress. Waiting for it to complete...");
            }
          }
          log("Press Ctrl+C to cancel.");
        }
        log(`Attempt ${attempt}: Waiting 10 seconds before next attempt`);
        sleep(10000);
        attempt++;
      } else {
        throw error;
      }
    }
  }
}

// ============================================================================
// Wait for Operation
// ============================================================================

function formatElapsed(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * Wait for a service operation (deployment, update, etc.) to complete.
 */
export function waitForOperation(
  config: AppRunnerConfig,
  log: (msg: string) => void
): { ok: boolean; finalStatus: string } {
  const serviceArn = getServiceArn(config);
  if (!serviceArn) {
    log("No App Runner service found.");
    return { ok: false, finalStatus: "NOT_FOUND" };
  }

  log(`Service ARN: ${serviceArn}`);

  const pollInterval = 10000; // 10 seconds
  const waitStartTime = Date.now();

  while (true) {
    const elapsed = formatElapsed(Date.now() - waitStartTime);
    const cmd = `aws apprunner describe-service --service-arn ${serviceArn} --region ${config.region} --output json`;

    try {
      const raw = execWithOutput(cmd);
      const parsed = raw ? JSON.parse(raw) as { Service?: { Status?: string } } : {};
      const status = parsed.Service?.Status ?? "UNKNOWN";

      if (status === "OPERATION_IN_PROGRESS") {
        const opInfo = getInProgressOperation(serviceArn, config.region);
        if (opInfo) {
          log(`${elapsed} Status: ${status} (${opInfo.type})`);
        } else {
          log(`${elapsed} Status: ${status}`);
        }
      } else {
        log(`${elapsed} Status: ${status}`);
      }

      if (status !== "OPERATION_IN_PROGRESS") {
        if (status === "RUNNING") {
          log("Operation complete - service is running");
        } else if (status === "PAUSED") {
          log("Operation complete - service is paused");
        } else {
          log(`Operation finished with status: ${status}`);
        }
        return { ok: status === "RUNNING" || status === "PAUSED", finalStatus: status };
      }

      sleep(pollInterval);
    } catch (error) {
      log(`Failed to get service status: ${(error as Error).message}`);
      return { ok: false, finalStatus: "ERROR" };
    }
  }
}

// ============================================================================
// Service Lifecycle
// ============================================================================

/**
 * Wait for any in-progress operation to complete before proceeding.
 * Returns the final status, or throws if timeout.
 */
function waitForOperationToFinish(
  serviceArn: string,
  config: AppRunnerConfig,
  log: (msg: string) => void,
  maxWaitMs: number = 600000
): string {
  const statusCmd = `aws apprunner describe-service --service-arn ${serviceArn} --region ${config.region} --query "Service.Status" --output text`;
  let status = execWithOutput(statusCmd, { ignoreError: true })?.trim() ?? "UNKNOWN";

  if (status !== "OPERATION_IN_PROGRESS") {
    return status;
  }

  log("Service has operation in progress. Waiting for it to complete...");
  const pollInterval = 15000;
  const startTime = Date.now();

  while (Date.now() - startTime < maxWaitMs) {
    sleep(pollInterval);
    status = execWithOutput(statusCmd, { ignoreError: true })?.trim() ?? "UNKNOWN";
    log(`Service status: ${status}`);
    if (status !== "OPERATION_IN_PROGRESS") {
      return status;
    }
  }

  throw new Error("Timed out waiting for in-progress operation. Try again later or check AWS console.");
}

/**
 * Delete an App Runner service.
 */
export function deleteService(
  config: AppRunnerConfig,
  log: (msg: string) => void
): AppRunnerControlResult {
  const serviceArn = getServiceArn(config);
  if (!serviceArn) {
    return { ok: false, action: "delete", error: "Service not found" };
  }

  try {
    // Wait for any in-progress operation first
    waitForOperationToFinish(serviceArn, config, log);

    log("Deleting App Runner service...");
    const deleteCmd = `aws apprunner delete-service --service-arn ${serviceArn} --region ${config.region}`;
    exec(deleteCmd);
    log("Delete initiated, waiting for service to be removed...");

    // Poll for deletion (max 5 minutes)
    const maxWait = 300000;
    const pollInterval = 10000;
    const startTime = Date.now();

    while (Date.now() - startTime < maxWait) {
      sleep(pollInterval);
      const checkArn = getServiceArn(config);
      if (!checkArn) {
        log("Service deleted successfully");
        return { ok: true, action: "delete", serviceArn };
      }
      log("Still deleting...");
    }

    return { ok: false, action: "delete", serviceArn, error: "Timed out waiting for deletion" };
  } catch (error) {
    return { ok: false, action: "delete", serviceArn, error: (error as Error).message };
  }
}

/**
 * Pause (stop) an App Runner service.
 */
export function pauseService(
  config: AppRunnerConfig,
  log: (msg: string) => void
): AppRunnerControlResult {
  const serviceArn = getServiceArn(config);
  if (!serviceArn) {
    return { ok: false, action: "pause", error: "Service not found" };
  }

  try {
    log("Stopping App Runner service...");
    const cmd = `aws apprunner pause-service --service-arn ${serviceArn} --region ${config.region}`;
    retryOnOperationInProgress(cmd, config, log);
    log(`Service paused: ${serviceArn}`);
    return { ok: true, action: "pause", serviceArn };
  } catch (error) {
    return { ok: false, action: "pause", serviceArn, error: (error as Error).message };
  }
}

/**
 * Resume a paused App Runner service.
 */
export function resumeService(
  config: AppRunnerConfig,
  log: (msg: string) => void
): AppRunnerControlResult {
  const serviceArn = getServiceArn(config);
  if (!serviceArn) {
    return { ok: false, action: "resume", error: "Service not found" };
  }

  try {
    log("Resuming App Runner service...");
    const cmd = `aws apprunner resume-service --service-arn ${serviceArn} --region ${config.region}`;
    retryOnOperationInProgress(cmd, config, log);
    log(`Service resumed: ${serviceArn}`);
    return { ok: true, action: "resume", serviceArn };
  } catch (error) {
    return { ok: false, action: "resume", serviceArn, error: (error as Error).message };
  }
}

// ============================================================================
// Deploy
// ============================================================================

export interface DeployToAppRunnerOptions {
  /** ECR image URI to deploy */
  imageUri: string;
  /** App Runner config */
  config: AppRunnerConfig;
  /** Force delete and recreate service */
  force?: boolean;
  /** Logging function */
  log?: (msg: string) => void;
}

/**
 * Deploy a Docker image to App Runner.
 * Creates a new service or updates an existing one.
 */
export function deployToAppRunner(options: DeployToAppRunnerOptions): AppRunnerDeployResult {
  const { imageUri, config, force = false } = options;
  const log = options.log ?? console.log;

  try {
    let existingArn = getServiceArn(config);

    // Force mode: delete existing service first
    if (force && existingArn) {
      log("Force mode: deleting existing service first...");
      const deleteResult = deleteService(config, log);
      if (!deleteResult.ok) {
        return { ok: false, error: `Failed to delete service: ${deleteResult.error}` };
      }
      existingArn = null;
    }

    // Build runtime environment variables
    const runtimeEnvVars: Record<string, string> = { ...config.envVars };
    if (config.s3Bucket) {
      runtimeEnvVars["TRAVELR_S3_BUCKET"] = config.s3Bucket;
    }

    // Ensure App Runner ECR access role exists
    const accessRoleName = "AppRunnerECRAccessRole";
    const accessRoleResult = ensureAppRunnerAccessRole(accessRoleName, log);
    if (!accessRoleResult.ok) {
      return { ok: false, error: `Failed to create access role: ${accessRoleResult.error}` };
    }

    // Build source configuration
    const sourceConfig = {
      ImageRepository: {
        ImageIdentifier: imageUri,
        ImageRepositoryType: "ECR",
        ImageConfiguration: {
          Port: String(config.port),
          RuntimeEnvironmentVariables: runtimeEnvVars
        }
      },
      AutoDeploymentsEnabled: false,
      AuthenticationConfiguration: {
        AccessRoleArn: accessRoleResult.arn
      }
    };

    // Instance configuration
    const instanceConfig: { InstanceRoleArn?: string } = {};
    if (config.instanceRoleArn) {
      instanceConfig.InstanceRoleArn = config.instanceRoleArn;
      log(`Instance role for S3 access: ${config.instanceRoleArn}`);
    }

    // Write configs to temp files
    const configPath = path.join(os.tmpdir(), "apprunner-config.json");
    const instanceConfigPath = path.join(os.tmpdir(), "apprunner-instance-config.json");
    fs.writeFileSync(configPath, JSON.stringify(sourceConfig, null, 2));
    fs.writeFileSync(instanceConfigPath, JSON.stringify(instanceConfig, null, 2));

    const configPathUnix = configPath.replace(/\\/g, "/");
    const instanceConfigPathUnix = instanceConfigPath.replace(/\\/g, "/");

    try {
      if (existingArn) {
        // Update existing service
        log("Updating existing App Runner service...");

        const updateCmd = `aws apprunner update-service --no-cli-pager --service-arn ${existingArn} --source-configuration file://${configPathUnix} --instance-configuration file://${instanceConfigPathUnix} --region ${config.region}`;
        retryOnOperationInProgress(updateCmd, config, log);
        log("Service configuration updated");

        // CRITICAL: ALWAYS call start-deployment after update-service!
        // 
        // When pushing new code to the same ECR tag (e.g., :latest), update-service
        // only updates the service CONFIGURATION. It does NOT trigger a new deployment
        // or pull the new image. The result is:
        //   - AWS reports "UPDATE_SERVICE: SUCCEEDED"
        //   - Service shows "RUNNING"
        //   - But the OLD code is still running!
        //
        // start-deployment forces App Runner to actually pull the latest image
        // for the configured tag and deploy it.
        //
        // See: https://github.com/aws/apprunner-roadmap/issues - this is a known gotcha
        log("Triggering deployment to pull latest image...");
        const startDeployCmd = `aws apprunner start-deployment --service-arn ${existingArn} --region ${config.region}`;
        try {
          exec(startDeployCmd);
          log("Deployment started");
        } catch (e) {
          // start-deployment may fail if an operation is already in progress
          // In that case, the update-service already triggered a deploy
          log("start-deployment skipped (operation already in progress)");
        }
        log(`Service ARN: ${existingArn}`);
      } else {
        // Create new service
        log("Creating new App Runner service...");
        const createCmd = `aws apprunner create-service --no-cli-pager --service-name ${config.serviceName} --source-configuration file://${configPathUnix} --instance-configuration file://${instanceConfigPathUnix} --region ${config.region}`;
        retryOnOperationInProgress(createCmd, config, log);
        log("Service creation initiated");
      }
    } finally {
      // Clean up temp files
      try { fs.unlinkSync(configPath); } catch { /* ignore */ }
      try { fs.unlinkSync(instanceConfigPath); } catch { /* ignore */ }
    }

    // Get service URL
    log("Fetching service URL...");
    const info = getServiceStatus(config);
    
    return {
      ok: true,
      serviceArn: info.arn ?? undefined,
      serviceUrl: info.url ?? undefined
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
