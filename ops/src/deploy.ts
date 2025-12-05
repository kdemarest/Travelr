/**
 * deploy.ts - Central deploy functions with spec-compliant naming
 * 
 * All deploy operations are exposed as deploy* functions per the spec.
 */

import { opsConfig, type OpsConfig } from "./ops-config.js";
import { deployQuick as quickDeployImpl, type DeployQuickOptions, type DeployQuickResult } from "./deploy-quick.js";
import { stopService, startService, getStatus, waitForService, type ServiceControlOptions } from "./service-control.js";
import { persistRemoteService, type RemoteAdminOptions, type PersistResult } from "./remote-admin.js";
import { createDeployableZip, type CreateDeployableZipOptions } from "./create-deployable-zip.js";

// ============================================================================
// Re-exports with spec-compliant names
// ============================================================================

// deployQuick is already correctly named - re-export directly
export { deployQuick } from "./deploy-quick.js";
export type { DeployQuickOptions, DeployQuickResult } from "./deploy-quick.js";

/**
 * Create a deployment zip file.
 */
export async function deployCreateZip(options?: Partial<CreateDeployableZipOptions>): Promise<string> {
  const config = opsConfig();
  return createDeployableZip({
    projectRoot: options?.projectRoot ?? config.projectRoot,
    include: options?.include ?? config.deployQuick.include,
    exclude: options?.exclude ?? config.deployQuick.exclude,
    outputPath: options?.outputPath
  });
}

/**
 * Persist data from the running service to S3.
 */
export async function deployPersist(options?: RemoteAdminOptions): Promise<PersistResult> {
  return persistRemoteService(options);
}

/**
 * Stop (pause) the App Runner service.
 */
export function deployStop(options?: ServiceControlOptions): { ok: boolean; serviceArn?: string; error?: string } {
  return stopService(options);
}

/**
 * Resume a paused App Runner service.
 */
export function deployResume(options?: ServiceControlOptions): { ok: boolean; serviceArn?: string; error?: string } {
  return startService(options);
}

/**
 * Get the current status of the App Runner service.
 */
export function deployStatus(options?: Omit<ServiceControlOptions, "wait">): {
  serviceName: string;
  arn: string | null;
  status: string;
  url: string | null;
  updatedAt?: string;
} {
  return getStatus(options);
}

/**
 * Wait for any in-progress operation to complete.
 */
export function deployWait(options?: Omit<ServiceControlOptions, "wait">): { ok: boolean; finalStatus: string } {
  return waitForService(options);
}

// ============================================================================
// deployFull - re-export from deploy-full.ts
// ============================================================================

export { deployFull, type DeployFullOptions, type DeployFullResult } from "./deploy-full.js";
