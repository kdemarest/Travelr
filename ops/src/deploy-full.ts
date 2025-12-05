/**
 * deploy-full.ts - Full Docker deploy to AWS App Runner
 * 
 * This orchestrates the complete deployment flow:
 * 1. Increment version number
 * 2. Load and validate secrets
 * 3. Check prerequisites (Docker, AWS CLI, credentials)
 * 4. Setup S3 bucket and IAM instance role
 * 5. Run smoke tests (optional)
 * 6. Persist data from running service to S3
 * 7. Build Docker image
 * 8. Push to ECR
 * 9. Deploy to App Runner
 * 10. Wait for deployment to complete
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { opsConfig, type OpsConfig } from "./ops-config.js";
import { loadSecrets } from "./load-secrets.js";
import { checkPrerequisites } from "./check-prerequisites.js";
import { setupS3AndInstanceRole } from "./aws-s3-iam.js";
import { runSmokeTests } from "./smoke-tests.js";
import { persistRemoteService } from "./remote-admin.js";
import { dockerBuild } from "./docker-build.js";
import { ecrLogin, ensureEcrRepository, ecrPush, getAwsAccountId, getEcrImageInfo } from "./aws-ecr.js";
import { deployToAppRunner, waitForOperation, getServiceStatus, getLatestOperation, getServiceArn, type AppRunnerConfig } from "./aws-apprunner.js";
import { getStatus } from "./service-control.js";

// ============================================================================
// Version Management
// ============================================================================

/**
 * Increment patch version in version.txt and return new version.
 */
function incrementVersion(projectRoot: string, log: (msg: string) => void): string {
  const versionPath = path.join(projectRoot, "version.txt");
  let version = "1.0.0";
  
  try {
    version = fs.readFileSync(versionPath, "utf-8").trim();
  } catch {
    log("No version.txt found, starting at 1.0.0");
  }
  
  // Parse and increment patch version
  const parts = version.split(".");
  const major = parseInt(parts[0] || "1", 10);
  const minor = parseInt(parts[1] || "0", 10);
  const patch = parseInt(parts[2] || "0", 10);
  const newVersion = `${major}.${minor}.${patch + 1}`;
  
  fs.writeFileSync(versionPath, newVersion + "\n");
  log(`Version: ${version} → ${newVersion}`);
  
  return newVersion;
}

// ============================================================================
// System Users - passwords hashed during deploy
// ============================================================================

interface SystemUserEnv {
  pwdEnvVar: string;      // Plaintext password env var (read from dev)
  hashEnvVar: string;     // Hash env var to set on server
}

const SYSTEM_USER_ENVS: SystemUserEnv[] = [
  { pwdEnvVar: "TRAVELR_ADMIN_PWD", hashEnvVar: "TRAVELR_ADMIN_PWDHASH" },
  { pwdEnvVar: "TRAVELR_DEPLOYBOT_PWD", hashEnvVar: "TRAVELR_DEPLOYBOT_PWDHASH" },
  { pwdEnvVar: "TRAVELR_TESTBOT_PWD", hashEnvVar: "TRAVELR_TESTBOT_PWDHASH" },
];

/**
 * Hash a password using scrypt (same algorithm as server).
 */
function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, 64, (err, derivedKey) => {
      if (err) reject(err);
      else resolve(`${salt}:${derivedKey.toString("hex")}`);
    });
  });
}

/**
 * Hash system user passwords from env vars.
 * Returns a map of HASH env vars to set on the server.
 */
async function hashSystemUserPasswords(log: (msg: string) => void): Promise<Record<string, string>> {
  const hashes: Record<string, string> = {};
  
  for (const { pwdEnvVar, hashEnvVar } of SYSTEM_USER_ENVS) {
    const pwd = process.env[pwdEnvVar];
    if (pwd) {
      log(`${pwdEnvVar}: Found, hashing...`);
      hashes[hashEnvVar] = await hashPassword(pwd);
      log(`${hashEnvVar}: Generated`);
    } else {
      log(`${pwdEnvVar}: Not set (skipping)`);
    }
  }
  
  return hashes;
}

// ============================================================================
// Types
// ============================================================================

export interface DeployFullOptions {
  /** Custom config (if not provided, loads from jeesty-ops-config.json) */
  config?: OpsConfig;
  /** Logging function */
  log?: (message: string) => void;
  /** Skip smoke tests */
  skipSmoke?: boolean;
  /** Skip persisting data before deploy */
  skipPersist?: boolean;
  /** Force delete and recreate App Runner service */
  force?: boolean;
  /** Wait for deployment to complete (default: true) */
  wait?: boolean;
  /** Dry run - log what would happen but don't execute */
  dryRun?: boolean;
}

export interface DeployFullResult {
  ok: boolean;
  serviceUrl?: string;
  serviceArn?: string;
  imageUri?: string;
  error?: string;
  duration?: number;
}

// ============================================================================
// Main
// ============================================================================

/**
 * Perform a full Docker deploy to AWS App Runner.
 */
export async function deployFull(options: DeployFullOptions = {}): Promise<DeployFullResult> {
  const startTime = Date.now();
  const config = options.config ?? opsConfig();
  const log = options.log ?? console.log;
  const wait = options.wait ?? true;
  const dryRun = options.dryRun ?? false;

  log("=".repeat(60));
  log(`FULL DEPLOY: ${config.name}${dryRun ? " (DRY RUN)" : ""}`);
  log("=".repeat(60));

  // Increment version FIRST (before any checks that might fail)
  let version = "unknown";
  if (!dryRun) {
    version = incrementVersion(config.projectRoot, log);
  } else {
    try {
      const versionPath = path.join(config.projectRoot, "version.txt");
      version = fs.readFileSync(versionPath, "utf-8").trim();
      log(`Version: ${version} (would increment in real deploy)`);
    } catch {
      log("Version: unknown (no version.txt)");
    }
  }

  // Check for in-progress operations FIRST
  if (!dryRun) {
    const status = getStatus({ config });
    if (status.status === "OPERATION_IN_PROGRESS") {
      throw new Error(
        `Cannot deploy: App Runner operation already in progress.\n` +
        `  Service: ${status.serviceName}\n` +
        `  Status: ${status.status}\n` +
        `  Wait for it to complete or use 'deploy -status' to check progress.`
      );
    }
  }

  try {
    // Step 1: Load secrets
    log("\n[1/10] Loading secrets...");
    const secretsResult = loadSecrets({
      required: config.secrets,
      log
    });
    if (!secretsResult.ok) {
      throw new Error(`Missing required secrets: ${secretsResult.missing.join(", ")}`);
    }
    
    // Hash system user passwords for production
    log("  Hashing system user passwords...");
    const passwordHashes = await hashSystemUserPasswords(log);
    const secrets = { ...secretsResult.secrets, ...passwordHashes };

    // Step 2: Check prerequisites
    log("\n[2/9] Checking prerequisites...");
    const prereqResult = checkPrerequisites({ log });
    if (!prereqResult.ok) {
      throw new Error(`Prerequisites failed: ${prereqResult.errors.join(", ")}`);
    }

    // Get AWS account ID
    const accountId = getAwsAccountId();
    if (!accountId) {
      throw new Error("Could not determine AWS account ID");
    }
    log(`AWS Account: ${accountId}`);

    // Step 3: Setup S3 and IAM
    log("\n[3/9] Setting up S3 bucket and IAM role...");
    const s3IamResult = setupS3AndInstanceRole({
      bucket: config.aws.s3Bucket,
      policyName: `${config.name}-S3Access`,
      roleName: `${config.name}-AppRunnerInstanceRole`,
      region: config.aws.region,
      s3PolicyPath: path.join(config.projectRoot, "deploy", "s3-policy.json"),
      trustPolicyPath: path.join(config.projectRoot, "deploy", "instance-trust-policy.json"),
      log
    });
    if (!s3IamResult.ok) {
      throw new Error(`S3/IAM setup failed: ${s3IamResult.error}`);
    }
    const instanceRoleArn = s3IamResult.instanceRoleArn!;
    log(`Instance Role: ${instanceRoleArn}`);

    // Step 4: Smoke tests
    if (options.skipSmoke) {
      log("\n[4/9] Smoke tests (skipped)");
    } else {
      log("\n[4/9] Running smoke tests...");
      const smokeResult = await runSmokeTests({
        runTests: true,
        log
      });
      if (!smokeResult.ok) {
        throw new Error(`Smoke tests failed: ${smokeResult.errors.join(", ")}`);
      }
    }

    // Step 5: Persist data from running service
    if (options.skipPersist) {
      log("\n[5/9] Persist (skipped)");
    } else {
      log("\n[5/9] Persisting data from running service...");
      try {
        const persistResult = await persistRemoteService({ 
          config,
          log 
        });
        if (persistResult.ok) {
          log(`Persisted ${persistResult.filesUploaded ?? 0} files`);
        } else {
          log(`Warning: Persist failed (continuing): ${persistResult.error}`);
        }
      } catch (err) {
        // Persist failure is not fatal - service might not be running
        log(`Warning: Could not persist data: ${err}`);
      }
    }

    // Step 6: Build Docker image
    log("\n[6/9] Building Docker image...");
    const imageTag = `${config.name}:latest`;
    
    if (dryRun) {
      log(`[DRY RUN] Would build: ${imageTag}`);
    } else {
      const buildResult = dockerBuild({
        imageName: config.name,
        tag: "latest",
        dockerfile: "deploy/Dockerfile",
        buildArgs: secrets,
        noCache: true,  // Always rebuild to ensure latest code is included
        log
      });
      if (!buildResult.ok) {
        throw new Error(`Docker build failed: ${buildResult.error}`);
      }
    }

    // Step 7: Push to ECR
    log("\n[7/9] Pushing to ECR...");
    const ecrConfig = {
      region: config.aws.region,
      repository: config.name,
      accountId
    };

    let remoteTag: string;
    if (dryRun) {
      remoteTag = `${accountId}.dkr.ecr.${config.aws.region}.amazonaws.com/${config.name}:latest`;
      log(`[DRY RUN] Would push to: ${remoteTag}`);
    } else {
      // Get current ECR image digest BEFORE push
      const beforeInfo = getEcrImageInfo(ecrConfig);
      const beforeDigest = beforeInfo?.digest;
      if (beforeDigest) {
        log(`Current ECR digest: ${beforeDigest.substring(0, 25)}...`);
      }

      // Login to ECR
      const loginResult = ecrLogin(ecrConfig, log);
      if (!loginResult.ok) {
        throw new Error(`ECR login failed: ${loginResult.error}`);
      }

      // Ensure repository exists
      const repoResult = ensureEcrRepository(ecrConfig, log);
      if (!repoResult.ok) {
        throw new Error(`ECR repository setup failed: ${repoResult.error}`);
      }

      // Push image
      const pushResult = ecrPush({
        localTag: imageTag,
        ecr: ecrConfig,
        log
      });
      if (!pushResult.ok) {
        throw new Error(`ECR push failed: ${pushResult.error}`);
      }
      remoteTag = pushResult.remoteTag;

      // VERIFY: Check that the digest actually changed
      const afterInfo = getEcrImageInfo(ecrConfig);
      const afterDigest = afterInfo?.digest;
      
      if (beforeDigest && afterDigest && beforeDigest === afterDigest) {
        log(`\n⚠️  WARNING: ECR image digest did NOT change!`);
        log(`   Before: ${beforeDigest.substring(0, 25)}...`);
        log(`   After:  ${afterDigest.substring(0, 25)}...`);
        log(`   This means Docker cache may have prevented the new code from being included.`);
        throw new Error("ECR push failed: Image digest unchanged - Docker may have cached old layers. Try 'docker system prune' or check Dockerfile COPY statements.");
      }
      
      if (afterDigest) {
        log(`New ECR digest: ${afterDigest.substring(0, 25)}...`);
        log(`✓ Image digest verified - new image was pushed`);
      }
    }

    // Step 8: Deploy to App Runner
    log("\n[8/9] Deploying to App Runner...");
    
    const appRunnerConfig: AppRunnerConfig = {
      region: config.aws.region,
      serviceName: config.name,
      port: config.container.port,
      envVars: {
        ...secrets,
        S3_BUCKET: config.aws.s3Bucket
      },
      s3Bucket: config.aws.s3Bucket,
      instanceRoleArn
    };

    // Log current status before deploy
    const beforeStatus = getServiceStatus(appRunnerConfig);
    if (beforeStatus.updatedAt) {
      log(`Current App Runner UpdatedAt: ${beforeStatus.updatedAt}`);
    }
    
    let serviceArn: string | undefined;
    let serviceUrl: string | undefined;
    
    if (dryRun) {
      log(`[DRY RUN] Would deploy ${remoteTag} to App Runner`);
    } else {
      const deployResult = deployToAppRunner({
        imageUri: remoteTag,
        config: appRunnerConfig,
        force: options.force,
        log
      });
      if (!deployResult.ok) {
        throw new Error(`App Runner deploy failed: ${deployResult.error}`);
      }
      serviceArn = deployResult.serviceArn;
      serviceUrl = deployResult.serviceUrl;
    }

    // Step 9: Wait for deployment
    if (wait && serviceArn && !dryRun) {
      log("\n[9/9] Waiting for deployment to complete...");
      const waitResult = waitForOperation(appRunnerConfig, log);
      if (!waitResult.ok) {
        throw new Error(`Deployment did not complete successfully`);
      }
      log(`Final status: ${waitResult.finalStatus}`);

      // VERIFY: Check that the latest operation is a successful START_DEPLOYMENT
      // (update-service alone doesn't actually deploy - see ops/specification.md)
      const latestOp = getLatestOperation(serviceArn, config.aws.region);
      if (latestOp) {
        log(`Latest operation: ${latestOp.type} - ${latestOp.status}`);
        if (latestOp.type === "START_DEPLOYMENT" && latestOp.status === "SUCCEEDED") {
          log(`✓ START_DEPLOYMENT succeeded - new image is deployed`);
        } else if (latestOp.type === "UPDATE_SERVICE") {
          log(`⚠️  WARNING: Latest operation was UPDATE_SERVICE, not START_DEPLOYMENT`);
          log(`   This may indicate the new image was not actually deployed.`);
          log(`   Try running: aws apprunner start-deployment --service-arn ${serviceArn}`);
        }
        if (latestOp.endedAt) {
          log(`Deployment completed at: ${latestOp.endedAt}`);
        }
      }
    } else {
      log("\n[9/9] Wait (skipped)");
    }

    // Done!
    const duration = Date.now() - startTime;
    log("\n" + "=".repeat(60));
    log(`DEPLOY COMPLETE${dryRun ? " (DRY RUN)" : ""}`);
    log("=".repeat(60));
    log(`Duration: ${(duration / 1000).toFixed(1)}s`);
    if (serviceUrl) {
      log(`Service URL: ${serviceUrl}`);
    }

    return {
      ok: true,
      serviceUrl,
      serviceArn,
      imageUri: remoteTag,
      duration
    };

  } catch (error) {
    const duration = Date.now() - startTime;
    log("\n" + "=".repeat(60));
    log("DEPLOY FAILED");
    log("=".repeat(60));
    log(`Error: ${error instanceof Error ? error.message : error}`);
    log(`Duration: ${(duration / 1000).toFixed(1)}s`);

    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      duration
    };
  }
}
