/**
 * aws-ecr.ts - Amazon ECR operations
 * 
 * Login, create repository, and push Docker images to ECR.
 */

import { execSync } from "node:child_process";

// ============================================================================
// Types
// ============================================================================

export interface EcrConfig {
  /** AWS region (e.g., "us-east-1") */
  region: string;
  /** ECR repository name */
  repository: string;
  /** AWS account ID (if not provided, will be detected) */
  accountId?: string;
}

export interface EcrLoginResult {
  ok: boolean;
  ecrUri: string;
  error?: string;
}

export interface EcrEnsureRepoResult {
  ok: boolean;
  created: boolean;
  repoUri: string;
  error?: string;
}

export interface EcrPushResult {
  ok: boolean;
  remoteTag: string;
  /** The image digest after push (sha256:...) */
  digest?: string;
  error?: string;
}

export interface EcrImageInfo {
  digest: string;
  pushedAt: string;
}

export interface EcrPushOptions {
  /** Local image tag (e.g., "myapp:latest") */
  localTag: string;
  /** ECR configuration */
  ecr: EcrConfig;
  /** Logging function */
  log?: (message: string) => void;
}

// ============================================================================
// Helpers
// ============================================================================

function exec(command: string): string {
  return execSync(command, { encoding: "utf-8", stdio: "pipe" }).trim();
}

function execQuiet(command: string): string {
  try {
    return exec(command);
  } catch {
    return "";
  }
}

/**
 * Get AWS account ID from current credentials.
 */
export function getAwsAccountId(): string | null {
  try {
    const result = exec("aws sts get-caller-identity --query Account --output text");
    return result || null;
  } catch {
    return null;
  }
}

/**
 * Get the latest image info (digest and push time) from ECR.
 */
export function getEcrImageInfo(ecr: EcrConfig): EcrImageInfo | null {
  const accountId = ecr.accountId ?? getAwsAccountId();
  if (!accountId) return null;

  try {
    const cmd = `aws ecr describe-images --repository-name ${ecr.repository} --region ${ecr.region} --query "sort_by(imageDetails, &imagePushedAt)[-1].{digest:imageDigest,pushedAt:imagePushedAt}" --output json`;
    const result = exec(cmd);
    const info = JSON.parse(result);
    return info ? { digest: info.digest, pushedAt: info.pushedAt } : null;
  } catch {
    return null;
  }
}

// ============================================================================
// ECR Operations
// ============================================================================

/**
 * Login to ECR. Must be called before push.
 */
export function ecrLogin(ecr: EcrConfig, log?: (msg: string) => void): EcrLoginResult {
  const accountId = ecr.accountId ?? getAwsAccountId();
  if (!accountId) {
    return { ok: false, ecrUri: "", error: "Could not determine AWS account ID" };
  }

  const ecrUri = `${accountId}.dkr.ecr.${ecr.region}.amazonaws.com`;
  log?.(`Logging into ECR: ${ecrUri}`);

  try {
    const loginCmd = `aws ecr get-login-password --region ${ecr.region} | docker login --username AWS --password-stdin ${ecrUri}`;
    exec(loginCmd);
    log?.("ECR login successful");
    return { ok: true, ecrUri };
  } catch (error) {
    return {
      ok: false,
      ecrUri,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Ensure ECR repository exists, create if not.
 */
export function ensureEcrRepository(ecr: EcrConfig, log?: (msg: string) => void): EcrEnsureRepoResult {
  const accountId = ecr.accountId ?? getAwsAccountId();
  if (!accountId) {
    return { ok: false, created: false, repoUri: "", error: "Could not determine AWS account ID" };
  }

  const ecrUri = `${accountId}.dkr.ecr.${ecr.region}.amazonaws.com`;
  const repoUri = `${ecrUri}/${ecr.repository}`;

  log?.(`Checking ECR repository: ${ecr.repository}`);

  // Check if exists
  const describeResult = execQuiet(
    `aws ecr describe-repositories --repository-names ${ecr.repository} --region ${ecr.region}`
  );

  if (describeResult && describeResult.includes(ecr.repository)) {
    log?.("ECR repository exists");
    return { ok: true, created: false, repoUri };
  }

  // Create it
  log?.(`Creating ECR repository: ${ecr.repository}`);
  try {
    exec(`aws ecr create-repository --repository-name ${ecr.repository} --region ${ecr.region}`);
    log?.("ECR repository created");
    return { ok: true, created: true, repoUri };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // "Already exists" is fine
    if (message.includes("RepositoryAlreadyExistsException")) {
      log?.("ECR repository exists");
      return { ok: true, created: false, repoUri };
    }
    return { ok: false, created: false, repoUri, error: message };
  }
}

/**
 * Tag and push a local Docker image to ECR.
 * Assumes ecrLogin() has already been called.
 */
export function ecrPush(options: EcrPushOptions): EcrPushResult {
  const log = options.log ?? (() => {});
  const accountId = options.ecr.accountId ?? getAwsAccountId();
  
  if (!accountId) {
    return { ok: false, remoteTag: "", error: "Could not determine AWS account ID" };
  }

  const ecrUri = `${accountId}.dkr.ecr.${options.ecr.region}.amazonaws.com`;
  const remoteTag = `${ecrUri}/${options.ecr.repository}:latest`;

  try {
    // Tag
    log(`Tagging: ${options.localTag} -> ${remoteTag}`);
    exec(`docker tag ${options.localTag} ${remoteTag}`);

    // Push
    log(`Pushing to ECR...`);
    exec(`docker push ${remoteTag}`);
    log(`Pushed: ${remoteTag}`);

    // Get the new digest to verify push worked
    const imageInfo = getEcrImageInfo(options.ecr);
    const digest = imageInfo?.digest;
    if (digest) {
      log(`Image digest: ${digest.substring(0, 20)}...`);
    }

    return { ok: true, remoteTag, digest };
  } catch (error) {
    return {
      ok: false,
      remoteTag,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Full ECR workflow: login, ensure repo, push.
 */
export function pushToEcr(options: EcrPushOptions): EcrPushResult {
  const log = options.log ?? (() => {});

  // Step 1: Login
  const loginResult = ecrLogin(options.ecr, log);
  if (!loginResult.ok) {
    return { ok: false, remoteTag: "", error: loginResult.error };
  }

  // Step 2: Ensure repo exists
  const repoResult = ensureEcrRepository(options.ecr, log);
  if (!repoResult.ok) {
    return { ok: false, remoteTag: "", error: repoResult.error };
  }

  // Step 3: Push
  return ecrPush(options);
}
