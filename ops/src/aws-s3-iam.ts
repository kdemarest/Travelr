/**
 * aws-s3-iam.ts - S3 bucket and IAM role operations
 * 
 * Create S3 buckets, IAM policies, and roles for App Runner.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { getAwsAccountId } from "./aws-ecr.js";

// ============================================================================
// Types
// ============================================================================

export interface S3Config {
  /** S3 bucket name */
  bucket: string;
  /** AWS region */
  region: string;
}

export interface IamPolicyConfig {
  /** Policy name */
  policyName: string;
  /** Path to policy document JSON file */
  policyDocumentPath: string;
  /** AWS account ID (if not provided, will be detected) */
  accountId?: string;
}

export interface IamRoleConfig {
  /** Role name */
  roleName: string;
  /** Path to trust policy JSON file */
  trustPolicyPath: string;
}

export interface EnsureResult {
  ok: boolean;
  created: boolean;
  arn?: string;
  error?: string;
}

export interface SetupS3IamOptions {
  /** S3 bucket name */
  bucket: string;
  /** S3 policy name */
  policyName: string;
  /** Instance role name */
  roleName: string;
  /** AWS region */
  region: string;
  /** Path to S3 policy JSON */
  s3PolicyPath: string;
  /** Path to instance trust policy JSON */
  trustPolicyPath: string;
  /** Logging function */
  log?: (message: string) => void;
}

export interface SetupS3IamResult {
  ok: boolean;
  bucketCreated: boolean;
  policyCreated: boolean;
  roleCreated: boolean;
  instanceRoleArn?: string;
  error?: string;
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

function sleep(ms: number): void {
  execSync(`node -e "setTimeout(() => {}, ${ms})"`, { stdio: "ignore" });
}

// ============================================================================
// S3 Operations
// ============================================================================

/**
 * Ensure S3 bucket exists, create if not.
 */
export function ensureS3Bucket(config: S3Config, log?: (msg: string) => void): EnsureResult {
  log?.(`Checking S3 bucket: ${config.bucket}`);

  // Check if bucket exists
  const headResult = execQuiet(`aws s3api head-bucket --bucket ${config.bucket} --region ${config.region}`);
  
  // head-bucket returns empty string on success, error message on failure
  if (headResult === "") {
    log?.("S3 bucket exists");
    return { ok: true, created: false };
  }

  // Try to create it
  log?.(`Creating S3 bucket: ${config.bucket}`);
  try {
    // Note: us-east-1 doesn't need LocationConstraint
    if (config.region === "us-east-1") {
      exec(`aws s3api create-bucket --bucket ${config.bucket} --region ${config.region}`);
    } else {
      exec(`aws s3api create-bucket --bucket ${config.bucket} --region ${config.region} --create-bucket-configuration LocationConstraint=${config.region}`);
    }
    log?.("S3 bucket created");
    return { ok: true, created: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("BucketAlreadyOwnedByYou")) {
      log?.("S3 bucket exists");
      return { ok: true, created: false };
    }
    if (message.includes("BucketAlreadyExists")) {
      return { ok: false, created: false, error: `Bucket name '${config.bucket}' is taken by another AWS account` };
    }
    return { ok: false, created: false, error: message };
  }
}

// ============================================================================
// IAM Policy Operations
// ============================================================================

/**
 * Ensure IAM policy exists, create if not.
 */
export function ensureIamPolicy(config: IamPolicyConfig, log?: (msg: string) => void): EnsureResult {
  const accountId = config.accountId ?? getAwsAccountId();
  if (!accountId) {
    return { ok: false, created: false, error: "Could not determine AWS account ID" };
  }

  const policyArn = `arn:aws:iam::${accountId}:policy/${config.policyName}`;
  log?.(`Checking IAM policy: ${config.policyName}`);

  // Check if exists
  const existing = execQuiet(`aws iam get-policy --policy-arn ${policyArn} --query "Policy.Arn" --output text`);
  if (existing && existing.startsWith("arn:")) {
    log?.("IAM policy exists");
    return { ok: true, created: false, arn: policyArn };
  }

  // Create it
  log?.(`Creating IAM policy: ${config.policyName}`);
  const docPath = config.policyDocumentPath.replace(/\\/g, "/");
  
  if (!fs.existsSync(config.policyDocumentPath)) {
    return { ok: false, created: false, error: `Policy document not found: ${config.policyDocumentPath}` };
  }

  try {
    exec(`aws iam create-policy --policy-name ${config.policyName} --policy-document file://${docPath}`);
    log?.("IAM policy created");
    return { ok: true, created: true, arn: policyArn };
  } catch (error) {
    return { ok: false, created: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ============================================================================
// IAM Role Operations
// ============================================================================

/**
 * Ensure IAM role exists, create if not.
 */
export function ensureIamRole(config: IamRoleConfig, log?: (msg: string) => void): EnsureResult {
  log?.(`Checking IAM role: ${config.roleName}`);

  // Check if exists
  const existing = execQuiet(`aws iam get-role --role-name ${config.roleName} --query "Role.Arn" --output text`);
  if (existing && existing.startsWith("arn:")) {
    log?.("IAM role exists");
    return { ok: true, created: false, arn: existing.trim() };
  }

  // Create it
  log?.(`Creating IAM role: ${config.roleName}`);
  const trustPath = config.trustPolicyPath.replace(/\\/g, "/");

  if (!fs.existsSync(config.trustPolicyPath)) {
    return { ok: false, created: false, error: `Trust policy not found: ${config.trustPolicyPath}` };
  }

  try {
    exec(`aws iam create-role --role-name ${config.roleName} --assume-role-policy-document file://${trustPath}`);
    log?.("IAM role created, waiting for propagation...");
    sleep(5000);
    
    const arn = execQuiet(`aws iam get-role --role-name ${config.roleName} --query "Role.Arn" --output text`);
    return { ok: true, created: true, arn: arn.trim() };
  } catch (error) {
    return { ok: false, created: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Attach a policy to a role.
 */
export function attachPolicyToRole(roleName: string, policyArn: string, log?: (msg: string) => void): boolean {
  log?.(`Attaching policy to role: ${roleName}`);

  // Check if already attached
  const attached = execQuiet(
    `aws iam list-attached-role-policies --role-name ${roleName} --query "AttachedPolicies[?PolicyArn=='${policyArn}'].PolicyArn" --output text`
  );

  if (attached && attached.includes(policyArn)) {
    log?.("Policy already attached");
    return true;
  }

  try {
    exec(`aws iam attach-role-policy --role-name ${roleName} --policy-arn ${policyArn}`);
    log?.("Policy attached");
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// App Runner Access Role
// ============================================================================

/**
 * Ensure App Runner ECR access role exists.
 * This role allows App Runner to pull images from ECR.
 */
export function ensureAppRunnerAccessRole(roleName: string, log?: (msg: string) => void): EnsureResult {
  log?.(`Checking App Runner ECR access role: ${roleName}`);

  // Check if exists
  const existing = execQuiet(`aws iam get-role --role-name ${roleName} --query "Role.Arn" --output text`);
  if (existing && existing.startsWith("arn:") && !existing.includes("NoSuchEntity")) {
    log?.("App Runner access role exists");
    return { ok: true, created: false, arn: existing.trim() };
  }

  // Create trust policy
  const trustPolicy = {
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "build.apprunner.amazonaws.com" },
      Action: "sts:AssumeRole"
    }]
  };

  const trustPolicyPath = path.join(os.tmpdir(), "apprunner-trust-policy.json");
  fs.writeFileSync(trustPolicyPath, JSON.stringify(trustPolicy, null, 2));

  try {
    // Create role
    log?.(`Creating App Runner access role: ${roleName}`);
    exec(`aws iam create-role --role-name ${roleName} --assume-role-policy-document file://${trustPolicyPath.replace(/\\/g, "/")}`);

    // Attach ECR access policy
    const ecrPolicyArn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess";
    exec(`aws iam attach-role-policy --role-name ${roleName} --policy-arn ${ecrPolicyArn}`);

    // Clean up
    try { fs.unlinkSync(trustPolicyPath); } catch { /* ignore */ }

    // Wait for propagation
    log?.("Waiting for IAM propagation (10s)...");
    sleep(10000);

    const arn = execQuiet(`aws iam get-role --role-name ${roleName} --query "Role.Arn" --output text`);
    log?.("App Runner access role created");
    return { ok: true, created: true, arn: arn.trim() };
  } catch (error) {
    try { fs.unlinkSync(trustPolicyPath); } catch { /* ignore */ }
    return { ok: false, created: false, error: error instanceof Error ? error.message : String(error) };
  }
}

// ============================================================================
// Combined Setup
// ============================================================================

/**
 * Full S3 + IAM setup: bucket, policy, role, attach.
 */
export function setupS3AndInstanceRole(options: SetupS3IamOptions): SetupS3IamResult {
  const log = options.log ?? (() => {});

  // 1. Ensure S3 bucket
  const bucketResult = ensureS3Bucket({ bucket: options.bucket, region: options.region }, log);
  if (!bucketResult.ok) {
    return { ok: false, bucketCreated: false, policyCreated: false, roleCreated: false, error: bucketResult.error };
  }

  // 2. Ensure IAM policy
  const policyResult = ensureIamPolicy({
    policyName: options.policyName,
    policyDocumentPath: options.s3PolicyPath
  }, log);
  if (!policyResult.ok) {
    return { ok: false, bucketCreated: bucketResult.created, policyCreated: false, roleCreated: false, error: policyResult.error };
  }

  // 3. Ensure instance role
  const roleResult = ensureIamRole({
    roleName: options.roleName,
    trustPolicyPath: options.trustPolicyPath
  }, log);
  if (!roleResult.ok) {
    return { ok: false, bucketCreated: bucketResult.created, policyCreated: policyResult.created, roleCreated: false, error: roleResult.error };
  }

  // 4. Attach policy to role
  const attached = attachPolicyToRole(options.roleName, policyResult.arn!, log);
  if (!attached) {
    return { ok: false, bucketCreated: bucketResult.created, policyCreated: policyResult.created, roleCreated: roleResult.created, error: "Failed to attach policy to role" };
  }

  return {
    ok: true,
    bucketCreated: bucketResult.created,
    policyCreated: policyResult.created,
    roleCreated: roleResult.created,
    instanceRoleArn: roleResult.arn
  };
}
