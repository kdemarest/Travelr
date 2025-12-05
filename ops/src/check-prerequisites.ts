/**
 * check-prerequisites.ts - Verify deployment prerequisites
 * 
 * Checks that Docker, AWS CLI, and credentials are properly configured.
 */

import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { findProjectRoot } from "./ops-config.js";

// ============================================================================
// Types
// ============================================================================

export interface PrerequisiteCheckOptions {
  /** Logging function */
  log?: (message: string) => void;
  /** Skip Docker checks (for non-Docker deploys like quick-deploy) */
  skipDocker?: boolean;
  /** Expected port (validates against config) */
  expectedPort?: number;
}

export interface PrerequisiteCheckResult {
  ok: boolean;
  errors: string[];
  docker?: { version: string; running: boolean };
  aws?: { version: string; account: string; arn: string };
  dockerfile?: { found: boolean; path: string };
  port?: { configured: number; valid: boolean };
}

// ============================================================================
// Helpers
// ============================================================================

function execQuiet(command: string): string {
  try {
    return execSync(command, { encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return "";
  }
}

// ============================================================================
// Main
// ============================================================================

export function checkPrerequisites(options: PrerequisiteCheckOptions = {}): PrerequisiteCheckResult {
  const log = options.log ?? (() => {});
  const errors: string[] = [];
  const result: PrerequisiteCheckResult = { ok: true, errors };

  // Check Docker (unless skipped)
  if (!options.skipDocker) {
    log("Checking Docker...");
    
    const dockerVersion = execQuiet("docker --version");
    if (!dockerVersion) {
      errors.push("Docker is not installed or not in PATH");
    } else {
      const dockerRunning = execQuiet("docker info") !== "";
      result.docker = { version: dockerVersion, running: dockerRunning };
      
      if (!dockerRunning) {
        errors.push("Docker daemon is not running. Start Docker Desktop.");
      } else {
        log(`Docker: ${dockerVersion}`);
      }
    }
  }

  // Check AWS CLI
  log("Checking AWS CLI...");
  
  const awsVersion = execQuiet("aws --version");
  if (!awsVersion) {
    errors.push("AWS CLI is not installed or not in PATH");
  } else {
    log(`AWS CLI: ${awsVersion.split(" ")[0]}`);
    
    // Check AWS credentials
    const identityJson = execQuiet("aws sts get-caller-identity --output json");
    if (!identityJson) {
      errors.push("AWS credentials not configured. Run: aws configure");
    } else {
      try {
        const identity = JSON.parse(identityJson);
        result.aws = {
          version: awsVersion.split(" ")[0],
          account: identity.Account,
          arn: identity.Arn
        };
        log(`AWS Account: ${identity.Account}`);
      } catch {
        errors.push("Failed to parse AWS identity response");
      }
    }
  }

  // Check Dockerfile exists (unless Docker is skipped)
  if (!options.skipDocker) {
    const projectRoot = findProjectRoot();
    const dockerfilePath = path.join(projectRoot, "deploy", "Dockerfile");
    const found = fs.existsSync(dockerfilePath);
    result.dockerfile = { found, path: dockerfilePath };
    
    if (!found) {
      errors.push(`Dockerfile not found at ${dockerfilePath}`);
    } else {
      log("Dockerfile found");
    }
  }

  // Validate port if provided
  if (options.expectedPort !== undefined) {
    const projectRoot = findProjectRoot();
    const configPath = path.join(projectRoot, "dataConfig", "config.prod-debian.json");
    
    try {
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const configuredPort = config.port ?? 4000;
      const valid = configuredPort === options.expectedPort;
      result.port = { configured: configuredPort, valid };
      
      if (!valid) {
        errors.push(`Port mismatch: config has ${configuredPort} but expected ${options.expectedPort}`);
      } else {
        log(`Port: ${configuredPort}`);
      }
    } catch {
      errors.push(`Could not read production config at ${configPath}`);
    }
  }

  result.ok = errors.length === 0;
  return result;
}
