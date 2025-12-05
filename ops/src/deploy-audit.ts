/**
 * deploy-audit.ts - Audit deployment state without deploying
 * 
 * Checks the consistency between:
 * - Local Docker image
 * - ECR image
 * - App Runner service
 * - version.txt
 * 
 * Reports any discrepancies that might indicate a failed or stale deploy.
 */

import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { opsConfig } from "./ops-config.js";
import { getEcrImageInfo, getAwsAccountId } from "./aws-ecr.js";
import { getServiceStatus } from "./aws-apprunner.js";
import { getDockerImageInfo } from "./docker-build.js";

// ============================================================================
// Types
// ============================================================================

export interface DeployAuditOptions {
  log?: (msg: string) => void;
}

export interface DeployAuditResult {
  ok: boolean;
  checks: AuditCheck[];
  summary: string;
}

interface AuditCheck {
  name: string;
  status: "pass" | "warn" | "fail" | "info";
  message: string;
  details?: string;
}

// ============================================================================
// Main
// ============================================================================

export function deployAudit(options: DeployAuditOptions = {}): DeployAuditResult {
  const log = options.log ?? console.log;
  const config = opsConfig();
  const checks: AuditCheck[] = [];
  
  log("=".repeat(60));
  log("DEPLOY AUDIT");
  log("=".repeat(60));
  log(`Project: ${config.name}`);
  log("");

  // 1. Check version.txt
  log("[1/5] Checking version.txt...");
  const versionPath = path.join(config.projectRoot, "version.txt");
  let localVersion = "unknown";
  if (fs.existsSync(versionPath)) {
    localVersion = fs.readFileSync(versionPath, "utf-8").trim();
    checks.push({
      name: "version.txt",
      status: "info",
      message: `Local version: ${localVersion}`,
    });
    log(`  Local version: ${localVersion}`);
  } else {
    checks.push({
      name: "version.txt",
      status: "warn",
      message: "version.txt not found",
    });
    log(`  ⚠️  version.txt not found`);
  }

  // 2. Check local Docker image
  log("\n[2/5] Checking local Docker image...");
  const imageTag = `${config.name}:latest`;
  const localImageInfo = getDockerImageInfo(imageTag);
  if (localImageInfo) {
    const createdDate = new Date(localImageInfo.createdAt).toISOString();
    checks.push({
      name: "Local Docker image",
      status: "info",
      message: `Created: ${createdDate}`,
      details: `ID: ${localImageInfo.id.substring(0, 20)}...`,
    });
    log(`  Image: ${imageTag}`);
    log(`  Created: ${createdDate}`);
    log(`  ID: ${localImageInfo.id.substring(0, 25)}...`);
  } else {
    checks.push({
      name: "Local Docker image",
      status: "warn",
      message: `Image ${imageTag} not found locally`,
    });
    log(`  ⚠️  Image ${imageTag} not found locally`);
  }

  // 3. Check ECR image
  log("\n[3/5] Checking ECR image...");
  const accountId = getAwsAccountId();
  if (!accountId) {
    checks.push({
      name: "ECR image",
      status: "fail",
      message: "Could not get AWS account ID",
    });
    log(`  ❌ Could not get AWS account ID`);
  } else {
    const ecrConfig = {
      region: config.aws.region,
      repository: config.name,
      accountId,
    };
    const ecrInfo = getEcrImageInfo(ecrConfig);
    if (ecrInfo) {
      const pushedDate = new Date(ecrInfo.pushedAt).toISOString();
      checks.push({
        name: "ECR image",
        status: "info",
        message: `Pushed: ${pushedDate}`,
        details: `Digest: ${ecrInfo.digest.substring(0, 25)}...`,
      });
      log(`  Repository: ${config.name}`);
      log(`  Pushed: ${pushedDate}`);
      log(`  Digest: ${ecrInfo.digest.substring(0, 30)}...`);
    } else {
      checks.push({
        name: "ECR image",
        status: "warn",
        message: "No image found in ECR",
      });
      log(`  ⚠️  No image found in ECR`);
    }
  }

  // 4. Check App Runner service
  log("\n[4/5] Checking App Runner service...");
  const appRunnerConfig = {
    region: config.aws.region,
    serviceName: config.name,
    port: config.container.port,
  };
  const serviceStatus = getServiceStatus(appRunnerConfig);
  if (serviceStatus.arn) {
    const statusEmoji = serviceStatus.status === "RUNNING" ? "✓" : 
                        serviceStatus.status === "PAUSED" ? "⏸" : "⚠️";
    checks.push({
      name: "App Runner service",
      status: serviceStatus.status === "RUNNING" ? "pass" : "warn",
      message: `Status: ${serviceStatus.status}`,
      details: serviceStatus.updatedAt ? `Updated: ${serviceStatus.updatedAt}` : undefined,
    });
    log(`  Status: ${statusEmoji} ${serviceStatus.status}`);
    log(`  URL: ${serviceStatus.url}`);
    if (serviceStatus.updatedAt) {
      log(`  Updated: ${serviceStatus.updatedAt}`);
    }
  } else {
    checks.push({
      name: "App Runner service",
      status: "warn",
      message: "Service not found",
    });
    log(`  ⚠️  Service not found`);
  }

  // 5. Check production /version endpoint
  log("\n[5/5] Checking production /version endpoint...");
  if (serviceStatus.url) {
    try {
      const versionUrl = `${serviceStatus.url}/version`;
      const response = execSync(`curl -s -o - -w "\\n%{http_code}" "${versionUrl}"`, {
        encoding: "utf-8",
        timeout: 10000,
      });
      const lines = response.trim().split("\n");
      const httpCode = lines.pop();
      const body = lines.join("\n").trim();
      
      if (httpCode === "200") {
        const prodVersion = body;
        const versionMatch = prodVersion === localVersion;
        checks.push({
          name: "Production /version",
          status: versionMatch ? "pass" : "warn",
          message: `Production version: ${prodVersion}`,
          details: versionMatch ? "Matches local" : `Local is ${localVersion}`,
        });
        log(`  Production version: ${prodVersion}`);
        if (versionMatch) {
          log(`  ✓ Matches local version`);
        } else {
          log(`  ⚠️  Local version is ${localVersion} - deploy may be needed`);
        }
      } else if (httpCode === "401") {
        checks.push({
          name: "Production /version",
          status: "fail",
          message: "401 Unauthorized - /version endpoint not exposed",
          details: "The deployed code doesn't have /version before auth middleware",
        });
        log(`  ❌ 401 Unauthorized`);
        log(`     The deployed code doesn't have /version before auth middleware.`);
        log(`     This means production is running OLD code.`);
      } else {
        checks.push({
          name: "Production /version",
          status: "warn",
          message: `HTTP ${httpCode}`,
        });
        log(`  ⚠️  HTTP ${httpCode}: ${body.substring(0, 100)}`);
      }
    } catch (error) {
      checks.push({
        name: "Production /version",
        status: "fail",
        message: "Could not reach production",
        details: error instanceof Error ? error.message : String(error),
      });
      log(`  ❌ Could not reach production: ${error}`);
    }
  } else {
    checks.push({
      name: "Production /version",
      status: "warn",
      message: "No service URL available",
    });
    log(`  ⚠️  No service URL available`);
  }

  // Summary
  log("\n" + "=".repeat(60));
  log("AUDIT SUMMARY");
  log("=".repeat(60));

  const fails = checks.filter(c => c.status === "fail");
  const warns = checks.filter(c => c.status === "warn");
  const passes = checks.filter(c => c.status === "pass");

  let summary: string;
  let ok: boolean;

  if (fails.length > 0) {
    summary = `❌ ${fails.length} issue(s) found`;
    ok = false;
    log(summary);
    for (const check of fails) {
      log(`  - ${check.name}: ${check.message}`);
      if (check.details) log(`    ${check.details}`);
    }
  } else if (warns.length > 0) {
    summary = `⚠️  ${warns.length} warning(s)`;
    ok = true;
    log(summary);
    for (const check of warns) {
      log(`  - ${check.name}: ${check.message}`);
    }
  } else {
    summary = `✓ All checks passed`;
    ok = true;
    log(summary);
  }

  return { ok, checks, summary };
}
