#!/usr/bin/env node
/**
 * deploy.js - Deploy Travelr to AWS App Runner
 * 
 * This script:
 * 1. Reads secrets from environment variables
 * 2. Builds and pushes Docker image to ECR
 * 3. Deploys to AWS App Runner
 * 
 * Prerequisites:
 * - AWS CLI installed and configured (aws configure)
 * - Docker Desktop running
 * - Environment variables set: OPENAI_API_KEY, GOOGLE_CS_API_KEY, GOOGLE_CS_CX
 * 
 * Usage: node deploy.js [--dry-run] [--skip-smoke] [--force] [--stop|--resume|--status]
 */

import { execSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Parse --name option
function getNameArg() {
  const idx = process.argv.findIndex(arg => arg === "--name" || arg === "-name");
  if (idx !== -1 && process.argv[idx + 1]) {
    return process.argv[idx + 1];
  }
  return null;
}

const customName = getNameArg();

// Configuration
const CONFIG = {
  appName: customName || "travelr",
  awsRegion: "us-east-1",
  ecrRepository: customName || "travelr",
  appRunnerService: customName || "travelr",
  s3Bucket: "travelr-persist",
  instanceRoleName: "TravelrAppRunnerInstanceRole",
  s3PolicyName: "TravelrS3Access",
  envVarsToPass: [
    "OPENAI_API_KEY",
    "GOOGLE_CS_API_KEY",
    "GOOGLE_CS_CX"
  ]
};

const args = process.argv.slice(2);
const helpFlags = new Set(["?", "help", "-help", "--help"]);
const shouldShowHelp = args.some((arg) => helpFlags.has(arg));
const isDryRun = args.includes("--dry-run");
const isVerbose = args.includes("--verbose") || args.includes("-v");
const skipSmoke = args.includes("--skip-smoke");
const isForce = args.includes("--force") || args.includes("force");
const shouldStop = args.some((arg) => arg === "--stop" || arg === "-stop");
const shouldResume = args.some((arg) => arg === "--resume" || arg === "-resume");
const shouldShowStatus = args.some((arg) => arg === "--status" || arg === "-status");
const shouldWait = args.some((arg) => arg === "--wait" || arg === "-wait");
const isQuickDeploy = args.includes("--quick") || args.includes("-quick");
const deployArgs = process.argv.slice(2);
const deployCommandLabel = deployArgs.length ? `deploy ${deployArgs.join(" ")}` : "deploy";
const isStatusMinimal = shouldShowStatus && !isVerbose;
const isControlMinimal = (shouldStop || shouldResume) && !isVerbose;
const isFullDeploy = !shouldShowHelp && !shouldShowStatus && !shouldStop && !shouldResume && !isQuickDeploy;
const suppressCommandLogs = !isVerbose;
const suppressConsoleOutput = isStatusMinimal || isControlMinimal;

// Deployment mode - for future: could be "tag" for tagged releases
const deployMode = "lazy";
const deployModeDescription = "Lazy deploy from local files";

// Load production config to get port
const prodConfigPath = path.join(__dirname, "dataConfig", "config.prod-debian.json");
const prodConfig = JSON.parse(fs.readFileSync(prodConfigPath, "utf-8"));
const serverPort = String(prodConfig.port ?? 4000);
const DOCKERFILE_PORT = "4000"; // Hardcoded in Dockerfile - must match config

// ============================================================================
// Logging utilities
// ============================================================================

// Log file setup - write all output to dataDiagnostics/deploy-{timestamp}.log
const logTimestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const logDir = path.join(__dirname, "dataDiagnostics");
const logFilePath = path.join(logDir, `deploy-${logTimestamp}.log`);
fs.mkdirSync(logDir, { recursive: true });
const logStream = fs.createWriteStream(logFilePath, { flags: "a" });

// Strip ANSI color codes for log file
function stripColors(str) {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function writeToLog(message) {
  logStream.write(stripColors(message) + "\n");
}

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  gray: "\x1b[90m"
};

// Timing utilities
const deployStartTime = Date.now();
let stepStartTime = Date.now();

function startTimer() {
  stepStartTime = Date.now();
}

function log(message, color = colors.reset, options = {}) {
  const { forceConsole = false } = options;
  const coloredMessage = `${color}${message}${colors.reset}`;
  if (!suppressConsoleOutput || forceConsole) {
    console.log(coloredMessage);
  }
  writeToLog(message);
}

function logStep(step, message, options) {
  log(`\n${"=".repeat(60)}`, colors.blue, options);
  log(`  Step ${step}: ${message}`, colors.bright + colors.blue, options);
  log(`${"=".repeat(60)}`, colors.blue, options);
  startTimer();
}

function logSuccess(message, options) {
  log(`  [OK] ${message}`, colors.green, options);
}

function logWarning(message, options) {
  log(`  [WARN] ${message}`, colors.yellow, options);
}

function logError(message, options) {
  log(`  [FAIL] ${message}`, colors.red, options);
}

function logInfo(message, options) {
  log(`  [INFO] ${message}`, colors.cyan, options);
}

function logCommand(cmd) {
  log(`  $ ${cmd}`, colors.gray, { forceConsole: !suppressCommandLogs });
}

function logDryRun(message, options) {
  log(`  [DRY RUN] ${message}`, colors.yellow, options);
}

function reportDuration(label = "Step") {
  if (!isVerbose) return;
  const elapsed = ((Date.now() - stepStartTime) / 1000).toFixed(1);
  log(`  [TIME] ${label} completed in ${elapsed}s`, colors.gray);
}

function reportTotalDuration() {
  if (!isVerbose) return;
  const elapsed = ((Date.now() - deployStartTime) / 1000).toFixed(1);
  log(`\n  [TIME] Total deploy time: ${elapsed}s`, colors.bright + colors.gray);
}

function printUsage() {
  const lines = [
    "Usage: node deploy.js [options]",
    "",
    "Options:",
    "  --name <custom>        Override default AWS resource names (service, ECR, etc.)",
    "  --dry-run              Show commands without executing them",
    "  --skip-smoke           Skip local smoke tests",
    "  --force                Delete and recreate the App Runner service before deploying",
    "  --stop                 Pause the App Runner service (stop billing)",
    "  --resume               Resume the App Runner service",
    "  --status               Display the App Runner service status and exit",
    "  --wait                 Wait for in-progress operations to complete (use with --status)",
    "  --quick                Quick deploy: zip source files and POST to running server",
    "  --test                 Test mode: run quick deploy but don't restart server (use with --quick)",
    "  --local                Target local dev server instead of AWS (use with --quick)",
    "  --verbose, -v          Stream full command output",
    "  --help, -help, help, ? Show this usage information",
    "",
    "Examples:",
    "  node deploy.js --dry-run --skip-smoke",
    "  node deploy.js --stop",
    "  node deploy.js --status --wait",
    "  node deploy.js --quick                    (fast deploy without Docker rebuild)",
    "  node deploy.js --quick --test --local     (test quick deploy against local server)"
  ];
  log("");
  lines.forEach((line) => log(`  ${line}`, colors.gray));
  log("");
}

// ============================================================================
// Command execution
// ============================================================================

function exec(command, options = {}) {
  logCommand(command);
  
  if (isDryRun && !options.allowInDryRun) {
    logDryRun("Skipped");
    return "[dry-run]";
  }
  
  try {
    // Always capture output so we can log it to file
    // In verbose mode, also print to console
    const result = execSync(command, {
      encoding: "utf-8",
      stdio: "pipe",
      ...options
    });
    const output = result?.trim() ?? "";
    
    // In verbose mode, print output to console and always log to file
    if (isVerbose && output) {
      console.log(output);
    }
    if (output) {
      logStream.write(output + "\n");
    }
    
    return output;
  } catch (error) {
    // Capture stderr/stdout from failed commands too
    if (error.stdout) {
      const stdout = error.stdout.toString().trim();
      if (stdout) {
        if (isVerbose) console.log(stdout);
        logStream.write(stdout + "\n");
      }
    }
    if (error.stderr) {
      const stderr = error.stderr.toString().trim();
      if (stderr) {
        if (isVerbose) console.error(stderr);
        logStream.write(stderr + "\n");
      }
    }
    
    if (options.ignoreError) {
      logWarning(`Command failed (ignored): ${error.message}`);
      return "";
    }
    throw error;
  }
}

function execWithOutput(command, options = {}) {
  return exec(command, { ...options, silent: true });
}

// ============================================================================
// Environment variable secrets
// ============================================================================

function loadAllSecrets() {
  logStep(1, "Loading secrets from environment variables");
  
  const secrets = {};
  let allFound = true;
  
  for (const secretName of CONFIG.envVarsToPass) {
    const value = process.env[secretName]?.trim();
    
    if (value) {
      secrets[secretName] = value;
      logSuccess(`${secretName}: Found (${value.length} chars)`);
    } else {
      logError(`${secretName}: NOT FOUND`);
      logInfo(`  Set it with: [Environment]::SetEnvironmentVariable("${secretName}", "your-key", "User")`);
      allFound = false;
    }
  }
  
  if (!allFound) {
    throw new Error("Missing required secrets. See above for details.");
  }
  
  reportDuration("Secrets");
  return secrets;
}

// ============================================================================
// Prerequisite checks
// ============================================================================

function checkPrerequisites() {
  logStep(2, "Checking prerequisites");
  
  // Check Docker
  try {
    const dockerVersion = execWithOutput("docker --version", { allowInDryRun: true });
    logSuccess(`Docker: ${dockerVersion}`);
  } catch {
    throw new Error("Docker is not installed or not in PATH");
  }
  
  // Check Docker is running
  try {
    execWithOutput("docker info", { allowInDryRun: true });
    logSuccess("Docker daemon is running");
  } catch {
    throw new Error("Docker daemon is not running. Start Docker Desktop.");
  }
  
  // Check AWS CLI
  try {
    const awsVersion = execWithOutput("aws --version", { allowInDryRun: true });
    logSuccess(`AWS CLI: ${awsVersion.split(" ")[0]}`);
  } catch {
    throw new Error("AWS CLI is not installed or not in PATH");
  }
  
  // Check AWS credentials
  try {
    const identity = execWithOutput("aws sts get-caller-identity --output json", { allowInDryRun: true });
    const parsed = JSON.parse(identity);
    logSuccess(`AWS Account: ${parsed.Account} (${parsed.Arn})`);
  } catch {
    throw new Error("AWS credentials not configured. Run: aws configure");
  }
  
  // Check Dockerfile exists
  const dockerfilePath = path.join(__dirname, "deploy", "Dockerfile");
  if (!fs.existsSync(dockerfilePath)) {
    throw new Error(`Dockerfile not found at ${dockerfilePath}`);
  }
  logSuccess("Dockerfile found");
  
  // Validate config port matches Dockerfile's hardcoded port
  if (serverPort !== DOCKERFILE_PORT) {
    throw new Error(`Port mismatch: config.prod-debian.json has port=${serverPort} but Dockerfile expects ${DOCKERFILE_PORT}. Update the config to match.`);
  }
  logSuccess(`Port configuration: ${serverPort}`);
  reportDuration("Prerequisites");
}

// ============================================================================
// S3 Bucket and Instance Role Setup
// ============================================================================

function ensureS3Bucket(accountId) {
  logInfo(`Checking for S3 bucket: ${CONFIG.s3Bucket}...`);
  
  // Check if bucket exists
  const headCmd = `aws s3api head-bucket --bucket ${CONFIG.s3Bucket} --region ${CONFIG.awsRegion}`;
  const exists = execWithOutput(headCmd, { ignoreError: true });
  
  if (exists !== "" && !exists.includes("404") && !exists.includes("NoSuchBucket")) {
    // Check succeeded (no output means bucket exists and we have access)
    logSuccess(`S3 bucket exists: ${CONFIG.s3Bucket}`);
    return;
  }
  
  // Need to check the error - might be 404 (not exists) or 403 (exists but no access)
  try {
    // Try to create it
    logInfo(`Creating S3 bucket: ${CONFIG.s3Bucket}...`);
    // Note: us-east-1 doesn't need LocationConstraint
    if (CONFIG.awsRegion === "us-east-1") {
      exec(`aws s3api create-bucket --bucket ${CONFIG.s3Bucket} --region ${CONFIG.awsRegion}`);
    } else {
      exec(`aws s3api create-bucket --bucket ${CONFIG.s3Bucket} --region ${CONFIG.awsRegion} --create-bucket-configuration LocationConstraint=${CONFIG.awsRegion}`);
    }
    logSuccess(`Created S3 bucket: ${CONFIG.s3Bucket}`);
  } catch (error) {
    if (error.message && error.message.includes("BucketAlreadyOwnedByYou")) {
      logSuccess(`S3 bucket exists: ${CONFIG.s3Bucket}`);
    } else if (error.message && error.message.includes("BucketAlreadyExists")) {
      throw new Error(`S3 bucket name '${CONFIG.s3Bucket}' is taken by another AWS account. Choose a different name.`);
    } else {
      throw error;
    }
  }
}

function ensureS3Policy(accountId) {
  const policyArn = `arn:aws:iam::${accountId}:policy/${CONFIG.s3PolicyName}`;
  
  logInfo(`Checking for IAM policy: ${CONFIG.s3PolicyName}...`);
  
  // Check if policy exists
  const getPolicyCmd = `aws iam get-policy --policy-arn ${policyArn} --query "Policy.Arn" --output text`;
  const existingArn = execWithOutput(getPolicyCmd, { ignoreError: true });
  
  if (existingArn && existingArn.startsWith("arn:")) {
    logSuccess(`IAM policy exists: ${CONFIG.s3PolicyName}`);
    return policyArn;
  }
  
  // Create the policy
  logInfo(`Creating IAM policy: ${CONFIG.s3PolicyName}...`);
  const policyDocPath = path.join(__dirname, "deploy", "s3-policy.json").replace(/\\/g, '/');
  const createPolicyCmd = `aws iam create-policy --policy-name ${CONFIG.s3PolicyName} --policy-document file://${policyDocPath}`;
  exec(createPolicyCmd);
  logSuccess(`Created IAM policy: ${CONFIG.s3PolicyName}`);
  
  return policyArn;
}

function ensureInstanceRole(accountId) {
  logInfo(`Checking for instance role: ${CONFIG.instanceRoleName}...`);
  
  // Check if role exists
  const getRoleCmd = `aws iam get-role --role-name ${CONFIG.instanceRoleName} --query "Role.Arn" --output text`;
  const existingArn = execWithOutput(getRoleCmd, { ignoreError: true });
  
  if (existingArn && existingArn.startsWith("arn:")) {
    logSuccess(`Instance role exists: ${CONFIG.instanceRoleName}`);
    return existingArn.trim();
  }
  
  // Create the role
  logInfo(`Creating instance role: ${CONFIG.instanceRoleName}...`);
  const trustPolicyPath = path.join(__dirname, "deploy", "instance-trust-policy.json").replace(/\\/g, '/');
  const createRoleCmd = `aws iam create-role --role-name ${CONFIG.instanceRoleName} --assume-role-policy-document file://${trustPolicyPath}`;
  exec(createRoleCmd);
  logSuccess(`Created instance role: ${CONFIG.instanceRoleName}`);
  
  // Wait for IAM propagation
  logInfo("Waiting for IAM role propagation (5 seconds)...");
  sleep(5000);
  
  // Get the role ARN
  const roleArn = execWithOutput(getRoleCmd);
  return roleArn.trim();
}

function attachS3PolicyToRole(accountId, s3PolicyArn) {
  logInfo(`Ensuring S3 policy is attached to instance role...`);
  
  // Check if already attached
  const listCmd = `aws iam list-attached-role-policies --role-name ${CONFIG.instanceRoleName} --query "AttachedPolicies[?PolicyArn=='${s3PolicyArn}'].PolicyArn" --output text`;
  const attached = execWithOutput(listCmd, { ignoreError: true });
  
  if (attached && attached.includes(s3PolicyArn)) {
    logSuccess("S3 policy already attached to instance role");
    return;
  }
  
  // Attach the policy
  const attachCmd = `aws iam attach-role-policy --role-name ${CONFIG.instanceRoleName} --policy-arn ${s3PolicyArn}`;
  exec(attachCmd);
  logSuccess("Attached S3 policy to instance role");
}

function setupS3AndInstanceRole(accountId) {
  logStep("2b", "Setting up S3 bucket and instance role");
  
  // 1. Create S3 bucket if needed
  ensureS3Bucket(accountId);
  
  // 2. Create S3 access policy if needed
  const s3PolicyArn = ensureS3Policy(accountId);
  
  // 3. Create instance role if needed
  const instanceRoleArn = ensureInstanceRole(accountId);
  
  // 4. Attach S3 policy to instance role
  attachS3PolicyToRole(accountId, s3PolicyArn);
  
  reportDuration("S3/IAM setup");
  return instanceRoleArn;
}

// ============================================================================
// Smoke tests
// ============================================================================

async function checkHealth(name, url) {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    const text = await response.text();
    return response.ok && text.trim() === "pong";
  } catch {
    return false;
  }
}

async function runSmokeTests() {
  logStep(3, "Running smoke tests");
  
  // Run unit tests
  logInfo("Running unit tests...");
  try {
    exec("npm test");
    logSuccess("Unit tests passed");
  } catch (error) {
    throw new Error("Unit tests failed. Fix tests before deploying.");
  }
  
  // Check if servers are already running
  logInfo("Checking if servers are already running...");
  
  const apiUrl = "http://localhost:4000/ping";
  const webUrl = "http://localhost:5173/ping";
  
  let apiOk = await checkHealth("API", apiUrl);
  let webOk = await checkHealth("Web", webUrl);
  
  let startedServers = false;
  let apiProcess = null;
  let webProcess = null;
  
  if (apiOk && webOk) {
    logSuccess("Both servers already running");
  } else {
    // Need to start one or both servers
    if (!apiOk) {
      logInfo("API server not running, starting it...");
      apiProcess = spawn("npm", ["run", "dev:server"], {
        cwd: __dirname,
        shell: true,
        stdio: "ignore",
        detached: true
      });
      startedServers = true;
    } else {
      logSuccess("API server already running");
    }
    
    if (!webOk) {
      logInfo("Web server not running, starting it...");
      webProcess = spawn("npm", ["run", "dev:client"], {
        cwd: __dirname,
        shell: true,
        stdio: "ignore",
        detached: true
      });
      startedServers = true;
    } else {
      logSuccess("Web server already running");
    }
    
    if (startedServers) {
      // Wait for servers to start
      logInfo("Waiting for servers to start (10 seconds)...");
      sleep(10000);
      
      // Re-check
      apiOk = await checkHealth("API", apiUrl);
      webOk = await checkHealth("Web", webUrl);
    }
  }
  
  // Report results
  if (apiOk) {
    logSuccess("API server health check passed");
  } else {
    logError("API server health check failed");
  }
  
  if (webOk) {
    logSuccess("Web server health check passed");
  } else {
    logError("Web server health check failed");
  }
  
  // Kill servers we started (leave pre-existing ones alone)
  if (startedServers) {
    logInfo("Stopping test servers we started...");
    try {
      if (process.platform === "win32") {
        if (apiProcess) execSync(`taskkill /pid ${apiProcess.pid} /T /F`, { stdio: "ignore" });
        if (webProcess) execSync(`taskkill /pid ${webProcess.pid} /T /F`, { stdio: "ignore" });
      } else {
        if (apiProcess) process.kill(-apiProcess.pid);
        if (webProcess) process.kill(-webProcess.pid);
      }
    } catch (e) {
      // Ignore errors killing processes
    }
  }
  
  if (!apiOk || !webOk) {
    throw new Error("Smoke tests failed. Servers did not respond to health checks.");
  }
  reportDuration("Smoke tests");
}

// ============================================================================
// Pre-deploy: Persist data from running service
// ============================================================================

async function persistRunningService() {
  logStep("3b", "Persisting data from running service");
  
  // Get the current service URL
  const urlCmd = `aws apprunner list-services --region ${CONFIG.awsRegion} --query "ServiceSummaryList[?ServiceName=='${CONFIG.appRunnerService}'].ServiceUrl" --output text`;
  const serviceUrl = execWithOutput(urlCmd, { ignoreError: true, allowInDryRun: true });
  
  if (!serviceUrl || serviceUrl === "None" || serviceUrl.trim().length === 0) {
    logInfo("No existing service found - skipping persist");
    reportDuration("Persist (skipped)");
    return;
  }
  
  const baseUrl = `https://${serviceUrl.trim()}`;
  logInfo(`Found running service: ${baseUrl}`);
  
  // We need credentials to call persist - use deploybot
  const deployUser = "deploybot";
  const deployPassword = process.env.TRAVELR_DEPLOYBOT_PWD;
  
  if (!deployPassword) {
    logWarning("TRAVELR_DEPLOYBOT_PWD not set - skipping persist");
    logInfo("Set it with: node setup.js TRAVELR_DEPLOYBOT_PWD <password>");
    reportDuration("Persist (skipped)");
    return;
  }
  
  // First, login to get an auth key
  logInfo("Logging in as deploybot...");
  try {
    const loginResponse = await fetch(`${baseUrl}/auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        user: deployUser,
        password: deployPassword,
        deviceId: "deploy-script"
      })
    });
    
    if (!loginResponse.ok) {
      const text = await loginResponse.text();
      logWarning(`Login failed: ${loginResponse.status} - ${text}`);
      logInfo("Continuing with deploy - persist skipped (password mismatch with deployed server)");
      reportDuration("Persist (skipped)");
      return;
    }
    
    const loginData = await loginResponse.json();
    if (!loginData.ok || !loginData.authKey) {
      logWarning(`Login failed: ${loginData.error || "No authKey returned"}`);
      reportDuration("Persist (failed)");
      return;
    }
    
    logSuccess("Login successful");
    const authKey = loginData.authKey;
    
    // Now call persist
    logInfo("Calling /admin/persist to sync data to S3...");
    const persistUrl = `${baseUrl}/admin/persist?user=${deployUser}&deviceId=deploy-script&authKey=${encodeURIComponent(authKey)}`;
    
    const persistResponse = await fetch(persistUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" }
    });
    
    if (!persistResponse.ok) {
      const text = await persistResponse.text();
      logWarning(`Persist failed: ${persistResponse.status} - ${text}`);
      reportDuration("Persist (failed)");
      return;
    }
    
    const persistData = await persistResponse.json();
    if (!persistData.ok) {
      logWarning(`Persist failed: ${persistData.error || "Unknown error"}`);
      reportDuration("Persist (failed)");
      return;
    }
    
    logSuccess(`Data persisted to S3: ${persistData.filesUploaded || 0} files`);
    reportDuration("Persist");
    
  } catch (error) {
    logWarning(`Persist failed: ${error.message}`);
    logInfo("Continuing with deploy - data may not be saved");
    reportDuration("Persist (failed)");
  }
}

// ============================================================================
// Docker build and push
// ============================================================================

function getAwsAccountId() {
  const identity = execWithOutput("aws sts get-caller-identity --query Account --output text", { allowInDryRun: true });
  return identity || "123456789012";
}

function buildDockerImage(secrets) {
  logStep(4, "Building Docker image");
  
  const imageTag = `${CONFIG.appName}:latest`;
  
  // Build the image with --no-cache to ensure we get a fresh image
  // This prevents AWS from skipping the deployment due to identical image digest
  const buildCmd = `docker build --no-cache -f deploy/Dockerfile -t ${imageTag} .`;
  exec(buildCmd);
  
  logSuccess(`Built image: ${imageTag}`);
  reportDuration("Docker build");
  return imageTag;
}

function pushToECR(imageTag, accountId) {
  logStep(5, "Pushing to Amazon ECR");
  
  const ecrUri = `${accountId}.dkr.ecr.${CONFIG.awsRegion}.amazonaws.com`;
  const repoUri = `${ecrUri}/${CONFIG.ecrRepository}`;
  
  // Login to ECR
  logInfo("Logging into ECR...");
  const loginCmd = `aws ecr get-login-password --region ${CONFIG.awsRegion} | docker login --username AWS --password-stdin ${ecrUri}`;
  exec(loginCmd);
  logSuccess("ECR login successful");
  
  // Create repository if it doesn't exist
  logInfo("Ensuring ECR repository exists...");
  const describeResult = execWithOutput(`aws ecr describe-repositories --repository-names ${CONFIG.ecrRepository} --region ${CONFIG.awsRegion}`, { ignoreError: true });
  
  if (describeResult && describeResult.includes(CONFIG.ecrRepository)) {
    logSuccess("ECR repository exists");
  } else {
    // Try to create it
    try {
      exec(`aws ecr create-repository --repository-name ${CONFIG.ecrRepository} --region ${CONFIG.awsRegion}`);
      logSuccess("ECR repository created");
    } catch (error) {
      // Check if it's "already exists" - that's fine
      if (error.message && error.message.includes("RepositoryAlreadyExistsException")) {
        logSuccess("ECR repository exists");
      } else {
        throw error;
      }
    }
  }
  
  // Tag and push
  const remoteTag = `${repoUri}:latest`;
  exec(`docker tag ${imageTag} ${remoteTag}`);
  logSuccess(`Tagged: ${remoteTag}`);
  
  exec(`docker push ${remoteTag}`);
  logSuccess(`Pushed to ECR: ${remoteTag}`);
  reportDuration("ECR push");
  
  return remoteTag;
}

// ============================================================================
// IAM Role for App Runner ECR Access
// ============================================================================

function ensureAppRunnerAccessRole(roleName) {
  logInfo("Checking for App Runner ECR access role...");
  
  // Check if role exists
  const getRoleCmd = `aws iam get-role --role-name ${roleName} --query "Role.Arn" --output text`;
  const existingArn = execWithOutput(getRoleCmd, { ignoreError: true });
  
  if (existingArn && !existingArn.includes("NoSuchEntity") && existingArn.startsWith("arn:")) {
    logSuccess(`Using existing role: ${roleName}`);
    return existingArn.trim();
  }
  
  logInfo("Creating App Runner ECR access role...");
  
  // Trust policy allowing App Runner to assume this role
  const trustPolicy = {
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: {
        Service: "build.apprunner.amazonaws.com"
      },
      Action: "sts:AssumeRole"
    }]
  };
  
  const trustPolicyPath = path.join(os.tmpdir(), 'apprunner-trust-policy.json');
  fs.writeFileSync(trustPolicyPath, JSON.stringify(trustPolicy, null, 2));
  
  // Create the role
  const createRoleCmd = `aws iam create-role --role-name ${roleName} --assume-role-policy-document file://${trustPolicyPath.replace(/\\/g, '/')}`;
  exec(createRoleCmd);
  
  // Attach the AWSAppRunnerServicePolicyForECRAccess managed policy
  const policyArn = "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess";
  const attachCmd = `aws iam attach-role-policy --role-name ${roleName} --policy-arn ${policyArn}`;
  exec(attachCmd);
  
  // Clean up temp file
  try { fs.unlinkSync(trustPolicyPath); } catch (e) { /* ignore */ }
  
  // Get the role ARN
  const roleArn = execWithOutput(getRoleCmd);
  logSuccess(`Created role: ${roleName}`);
  
  // Wait a bit for IAM propagation
  logInfo("Waiting for IAM role propagation (10 seconds)...");
  execSync('node -e "setTimeout(() => {}, 10000)"', { stdio: "ignore" });
  
  return roleArn.trim();
}

// ============================================================================
// App Runner deployment
// ============================================================================

function sleep(ms) {
  execSync(`node -e "setTimeout(() => {}, ${ms})"`, { stdio: "ignore" });
}

function getInProgressOperation(serviceArn) {
  if (!serviceArn) return null;
  try {
    const listOpsCmd = `aws apprunner list-operations --service-arn ${serviceArn} --region ${CONFIG.awsRegion} --max-results 5 --output json`;
    const raw = execWithOutput(listOpsCmd, { ignoreError: true, allowInDryRun: true });
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const ops = parsed.OperationSummaryList ?? [];
    // Find the first in-progress operation
    const inProgress = ops.find(op => op.Status === "IN_PROGRESS");
    if (inProgress) {
      return {
        type: inProgress.Type ?? "UNKNOWN",
        startedAt: inProgress.StartedAt ?? null,
        id: inProgress.Id ?? null
      };
    }
    return null;
  } catch {
    return null;
  }
}

function retryOnOperationInProgress(cmd, operationType) {
  let attempt = 1;
  
  while (true) {
    try {
      exec(cmd);
      return; // Success
    } catch (error) {
      const message = error.message || "";
      
      // Check if it's an "operation in progress" error
      if (message.includes("OPERATION_IN_PROGRESS") || message.includes("InvalidStateException")) {
        if (attempt === 1) {
          const serviceArn = getAppRunnerServiceArn();
          const opInfo = getInProgressOperation(serviceArn);
          if (opInfo) {
            const startedLabel = opInfo.startedAt ? ` (started ${opInfo.startedAt})` : "";
            logWarning(`Service has operation in progress: ${opInfo.type}${startedLabel}`);
          } else {
            logWarning(`Service has an operation in progress. Waiting for it to complete...`);
          }
          logInfo("Press Ctrl+C to cancel.");
        }
        logInfo(`Attempt ${attempt}: Waiting 10 seconds before next attempt`);
        sleep(10000);
        attempt++;
      } else {
        // Some other error, re-throw
        throw error;
      }
    }
  }
}

function deployToAppRunner(imageUri, instanceRoleArn) {
  logStep(6, "Deploying to AWS App Runner");
  
  // Check if service exists
  logInfo("Checking for existing App Runner service...");
  const listCmd = `aws apprunner list-services --region ${CONFIG.awsRegion} --query "ServiceSummaryList[?ServiceName=='${CONFIG.appRunnerService}'].ServiceArn" --output text`;
  let existingArn = execWithOutput(listCmd, { ignoreError: true });
  
  // If --force flag, delete the existing service first
  if (isForce && existingArn && existingArn !== "None" && existingArn.length > 0) {
    const arnTrimmed = existingArn.trim();
    
    // First, wait for any in-progress operation to finish
    logWarning("Force mode: Checking service status...");
    const statusCmd = `aws apprunner describe-service --service-arn ${arnTrimmed} --region ${CONFIG.awsRegion} --query "Service.Status" --output text`;
    let status = execWithOutput(statusCmd, { ignoreError: true })?.trim();
    
    if (status === "OPERATION_IN_PROGRESS") {
      logWarning("Service has operation in progress. Waiting for it to complete (or fail)...");
      const maxWait = 600000; // 10 minutes
      const pollInterval = 15000; // 15 seconds
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWait) {
        sleep(pollInterval);
        status = execWithOutput(statusCmd, { ignoreError: true })?.trim();
        logInfo(`Service status: ${status}`);
        if (status !== "OPERATION_IN_PROGRESS") {
          break;
        }
      }
      
      if (status === "OPERATION_IN_PROGRESS") {
        throw new Error("Timed out waiting for in-progress operation. Try again later or delete manually in AWS console.");
      }
    }
    
    logWarning("Deleting existing App Runner service...");
    const deleteCmd = `aws apprunner delete-service --service-arn ${arnTrimmed} --region ${CONFIG.awsRegion}`;
    try {
      exec(deleteCmd);
      logSuccess("Delete initiated, waiting for service to be removed...");
      
      // Wait for deletion to complete (poll every 10 seconds, max 5 minutes)
      const maxWait = 300000; // 5 minutes
      const pollInterval = 10000; // 10 seconds
      const startTime = Date.now();
      
      while (Date.now() - startTime < maxWait) {
        sleep(pollInterval);
        const checkCmd = `aws apprunner list-services --region ${CONFIG.awsRegion} --query "ServiceSummaryList[?ServiceName=='${CONFIG.appRunnerService}'].ServiceArn" --output text`;
        const checkArn = execWithOutput(checkCmd, { ignoreError: true });
        if (!checkArn || checkArn === "None" || checkArn.trim().length === 0) {
          logSuccess("Service deleted successfully");
          existingArn = null;
          break;
        }
        logInfo("Still deleting...");
      }
      
      if (existingArn) {
        throw new Error("Timed out waiting for service deletion");
      }
    } catch (error) {
      throw new Error(`Failed to delete service: ${error.message}`);
    }
  }
  
  // Build source configuration as JSON
  const runtimeEnvVars = {};
  for (const key of CONFIG.envVarsToPass) {
    if (process.env[key]) {
      runtimeEnvVars[key] = process.env[key];
    }
  }
  
  // Add S3 bucket name to environment so the app knows where to persist
  runtimeEnvVars["TRAVELR_S3_BUCKET"] = CONFIG.s3Bucket;
  
  // Hash system user passwords for production
  // System users auth directly against these hashes - no session tokens needed
  const systemUserEnvs = [
    { pwdEnvVar: "TRAVELR_ADMIN_PWD", hashEnvVar: "TRAVELR_ADMIN_PWDHASH" },
    { pwdEnvVar: "TRAVELR_DEPLOYBOT_PWD", hashEnvVar: "TRAVELR_DEPLOYBOT_PWDHASH" },
    { pwdEnvVar: "TRAVELR_TESTBOT_PWD", hashEnvVar: "TRAVELR_TESTBOT_PWDHASH" },
  ];
  
  for (const { pwdEnvVar, hashEnvVar } of systemUserEnvs) {
    const pwd = process.env[pwdEnvVar];
    if (pwd) {
      log(`  Hashing ${pwdEnvVar}...`);
      const salt = crypto.randomBytes(16).toString("hex");
      const derivedKey = crypto.scryptSync(pwd, salt, 64);
      runtimeEnvVars[hashEnvVar] = `${salt}:${derivedKey.toString("hex")}`;
    }
  }
  
  // Ensure App Runner ECR access role exists
  const accessRoleName = "AppRunnerECRAccessRole";
  const accessRoleArn = ensureAppRunnerAccessRole(accessRoleName);
  
  const sourceConfig = {
    ImageRepository: {
      ImageIdentifier: imageUri,
      ImageRepositoryType: "ECR",
      ImageConfiguration: {
        Port: serverPort,
        RuntimeEnvironmentVariables: runtimeEnvVars
      }
    },
    AutoDeploymentsEnabled: false,
    AuthenticationConfiguration: {
      AccessRoleArn: accessRoleArn
    }
  };
  
  // Instance configuration with IAM role for S3 access
  const instanceConfig = {
    InstanceRoleArn: instanceRoleArn
  };
  
  // Write configs to temp files (AWS CLI handles JSON from file better)
  const configPath = path.join(os.tmpdir(), 'apprunner-config.json');
  const instanceConfigPath = path.join(os.tmpdir(), 'apprunner-instance-config.json');
  fs.writeFileSync(configPath, JSON.stringify(sourceConfig, null, 2));
  fs.writeFileSync(instanceConfigPath, JSON.stringify(instanceConfig, null, 2));
  
  logInfo(`Instance role for S3 access: ${instanceRoleArn}`);
  
  if (existingArn && existingArn !== "None" && existingArn.length > 0) {
    // Update existing service
    logInfo("Updating existing App Runner service...");
    
    // Get the latest operation timestamp BEFORE update so we can verify a new one was created
    const preUpdateOpsCmd = `aws apprunner list-operations --service-arn ${existingArn} --region ${CONFIG.awsRegion} --query "OperationSummaryList[0].StartedAt" --output text`;
    const preUpdateLatestOp = execWithOutput(preUpdateOpsCmd, { ignoreError: true })?.trim() || "";
    
    const updateCmd = `aws apprunner update-service --service-arn ${existingArn} --source-configuration file://${configPath.replace(/\\/g, '/')} --instance-configuration file://${instanceConfigPath.replace(/\\/g, '/')} --region ${CONFIG.awsRegion}`;
    retryOnOperationInProgress(updateCmd, "update");
    
    // Verify a new operation was actually created
    sleep(2000); // Give AWS a moment to register the operation
    const postUpdateLatestOp = execWithOutput(preUpdateOpsCmd, { ignoreError: true })?.trim() || "";
    
    if (postUpdateLatestOp === preUpdateLatestOp) {
      // update-service didn't trigger a deployment - force one with start-deployment
      logWarning("update-service did not trigger a new deployment - forcing with start-deployment...");
      const startDeployCmd = `aws apprunner start-deployment --service-arn ${existingArn} --region ${CONFIG.awsRegion}`;
      try {
        exec(startDeployCmd);
        logSuccess("Deployment started");
      } catch (error) {
        logError(`Failed to start deployment: ${error.message}`);
        throw error;
      }
    } else {
      logSuccess("Service update initiated");
    }
    logInfo(`Service ARN: ${existingArn}`);
  } else {
    // Create new service
    logInfo("Creating new App Runner service...");
    
    const createCmd = `aws apprunner create-service --service-name ${CONFIG.appRunnerService} --source-configuration file://${configPath.replace(/\\/g, '/')} --instance-configuration file://${instanceConfigPath.replace(/\\/g, '/')} --region ${CONFIG.awsRegion}`;
    retryOnOperationInProgress(createCmd, "create");
    logSuccess("Service creation initiated");
  }
  
  // Clean up temp files
  try { fs.unlinkSync(configPath); } catch (e) { /* ignore */ }
  try { fs.unlinkSync(instanceConfigPath); } catch (e) { /* ignore */ }
  
  // Get service URL
  logInfo("Fetching service URL...");
  const urlCmd = `aws apprunner list-services --region ${CONFIG.awsRegion} --query "ServiceSummaryList[?ServiceName=='${CONFIG.appRunnerService}'].ServiceUrl" --output text`;
  const serviceUrl = execWithOutput(urlCmd, { ignoreError: true });
  
  reportDuration("App Runner deploy");
  
  if (serviceUrl && serviceUrl !== "None") {
    logSuccess(`Service URL: https://${serviceUrl}`);
    return `https://${serviceUrl.trim()}`;
  }
  return null;
}

function getAppRunnerServiceArn() {
  const listCmd = `aws apprunner list-services --region ${CONFIG.awsRegion} --query "ServiceSummaryList[?ServiceName=='${CONFIG.appRunnerService}'].ServiceArn" --output text`;
  const arn = execWithOutput(listCmd, { ignoreError: true, allowInDryRun: true });
  if (!arn || arn === "None" || !arn.trim()) {
    return null;
  }
  return arn.trim();
}

function controlAppRunnerService(action) {
  const isPause = action === "pause";
  const actionLabel = isPause ? "Stopping" : "Resuming";
  const minimalOutput = !isVerbose;
  if (!minimalOutput) {
    logStep("S", `${actionLabel} AWS App Runner service`);
  }
  const serviceArn = getAppRunnerServiceArn();
  if (!serviceArn) {
    logWarning("No App Runner service found to control.", minimalOutput ? { forceConsole: true } : undefined);
    if (!minimalOutput) {
      reportDuration("Service control");
    }
    return;
  }
  const cliAction = isPause ? "pause-service" : "resume-service";
  const pastTense = isPause ? "paused" : "resumed";
  const cmd = `aws apprunner ${cliAction} --service-arn ${serviceArn} --region ${CONFIG.awsRegion}`;
  retryOnOperationInProgress(cmd, cliAction);
  logSuccess(`Service ${pastTense}: ${serviceArn}`, minimalOutput ? { forceConsole: true } : undefined);
  if (!minimalOutput) {
    reportDuration("Service control");
  }
}

function formatElapsed(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function waitForDeployment() {
  logStep(7, "Waiting for deployment to complete");
  
  const serviceArn = getAppRunnerServiceArn();
  if (!serviceArn) {
    logWarning("No App Runner service found.");
    return;
  }
  
  logInfo(`Service ARN: ${serviceArn}`);
  
  const pollInterval = 10000; // 10 seconds
  const waitStartTime = Date.now();
  
  while (true) {
    const elapsed = formatElapsed(Date.now() - waitStartTime);
    const describeCmd = `aws apprunner describe-service --service-arn ${serviceArn} --region ${CONFIG.awsRegion} --output json`;
    try {
      const raw = execWithOutput(describeCmd, { allowInDryRun: true });
      const parsed = raw ? JSON.parse(raw) : {};
      const service = parsed.Service ?? {};
      const status = service.Status ?? "UNKNOWN";
      
      if (status === "OPERATION_IN_PROGRESS") {
        const opInfo = getInProgressOperation(serviceArn);
        if (opInfo) {
          logInfo(`${elapsed} Status: ${status} (${opInfo.type})`);
        } else {
          logInfo(`${elapsed} Status: ${status}`);
        }
      } else {
        logInfo(`${elapsed} Status: ${status}`);
      }
      
      if (status !== "OPERATION_IN_PROGRESS") {
        if (status === "RUNNING") {
          logSuccess("Deployment complete - service is running");
        } else {
          logWarning(`Deployment finished with status: ${status}`);
        }
        break;
      }
      
      sleep(pollInterval);
      
    } catch (error) {
      logError(`Failed to get service status: ${error.message}`);
      break;
    }
  }
  
  reportDuration("Wait for deployment");
}

function reportAppRunnerStatus() {
  const minimalistStatus = shouldShowStatus && !isVerbose;
  if (!minimalistStatus) {
    logStep("S", "Checking AWS App Runner service status");
  }
  const serviceArn = getAppRunnerServiceArn();
  if (!serviceArn) {
    const warningOptions = minimalistStatus ? { forceConsole: true } : undefined;
    logWarning("No App Runner service found.", warningOptions);
    if (!minimalistStatus) {
      reportDuration("Service status");
    }
    return;
  }
  
  const consoleOptions = minimalistStatus ? { forceConsole: true } : undefined;
  
  // Show ARN once at the start
  if (minimalistStatus) {
    logInfo(`Service ARN: ${serviceArn}`, consoleOptions);
  }
  
  const pollInterval = 10000; // 10 seconds
  let isFirstCheck = true;
  
  while (true) {
    const describeCmd = `aws apprunner describe-service --service-arn ${serviceArn} --region ${CONFIG.awsRegion} --output json`;
    try {
      const raw = execWithOutput(describeCmd, { allowInDryRun: true });
      const parsed = raw ? JSON.parse(raw) : {};
      const service = parsed.Service ?? {};
      const status = service.Status ?? "UNKNOWN";
      
      if (minimalistStatus) {
        // If operation in progress, show what operation it is
        if (status === "OPERATION_IN_PROGRESS") {
          const opInfo = getInProgressOperation(serviceArn);
          if (opInfo) {
            logInfo(`Status: ${status} (${opInfo.type})`, consoleOptions);
          } else {
            logInfo(`Status: ${status}`, consoleOptions);
          }
        } else {
          logInfo(`Status: ${status}`, consoleOptions);
        }
      } else {
        if (isFirstCheck) {
          const opStatus = service.OperationStatus ?? "UNKNOWN";
          const url = service.ServiceUrl ? `https://${service.ServiceUrl}` : "N/A";
          const runningStatus = service.RunningStatus ?? "UNKNOWN";
          logInfo(`Service ARN: ${serviceArn}`);
          logInfo(`Status: ${status}`);
          logInfo(`Operation status: ${opStatus}`);
          logInfo(`Running status: ${runningStatus}`);
          logInfo(`Service URL: ${url}`);
          if (service.UpdatedAt) {
            logInfo(`Last updated: ${service.UpdatedAt}`);
          }
        } else {
          // Subsequent checks in verbose wait mode
          if (status === "OPERATION_IN_PROGRESS") {
            const opInfo = getInProgressOperation(serviceArn);
            if (opInfo) {
              logInfo(`Status: ${status} (${opInfo.type})`);
            } else {
              logInfo(`Status: ${status}`);
            }
          } else {
            logInfo(`Status: ${status}`);
          }
        }
      }
      
      // If not waiting, or operation complete, exit the loop
      if (!shouldWait || status !== "OPERATION_IN_PROGRESS") {
        if (!minimalistStatus && isFirstCheck) {
          logSuccess("Status check complete");
        }
        if (shouldWait && !isFirstCheck) {
          logSuccess("Operation complete", consoleOptions);
        }
        break;
      }
      
      // Wait and poll again
      isFirstCheck = false;
      sleep(pollInterval);
      
    } catch (error) {
      logError(`Failed to get service status: ${error.message}`, consoleOptions);
      if (isVerbose && error.stack) {
        writeToLog(error.stack);
      }
      break;
    }
  }
  
  if (!minimalistStatus) {
    reportDuration("Service status");
  }
}

// ============================================================================
// Quick Deploy
// ============================================================================

/**
 * Quick deploy - uses @jeesty/ops deployQuick
 */
async function quickDeploy() {
  logStep(1, "Quick Deploy");
  
  // Dynamically import the ops package
  const { deployQuick: opsDeployQuick } = await import("./ops/src/deploy-quick.js");
  
  const result = await opsDeployQuick({
    log: (msg) => logInfo(msg)
  });
  
  if (!result.ok) {
    throw new Error(result.error || "Quick deploy failed");
  }
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  // Always write banner to log file; only show on console for full deploy
  const bannerLines = [
    "\n" + "=".repeat(60),
    `  TRAVELR ${deployCommandLabel.toUpperCase()}`,
    "  " + (isFullDeploy ? deployModeDescription : ""),
    "=".repeat(60),
    `\nLog file: ${logFilePath}\n`
  ];
  for (const line of bannerLines) {
    if (isFullDeploy) {
      log(line, line.includes("TRAVELR") ? colors.bright + colors.cyan : colors.gray);
    } else {
      writeToLog(line);
    }
  }
  
  if (isFullDeploy) {
    if (customName) {
      logInfo(`Using custom name: ${customName}\n`);
    }
    
    if (isForce) {
      logWarning("FORCE MODE - Will delete and recreate App Runner service\n");
    }
    
    if (isDryRun) {
      logWarning("DRY RUN MODE - No changes will be made\n");
    }
  }
  
  try {
    if (shouldShowHelp) {
      printUsage();
      logStream.end();
      return;
    }

    if ((shouldStop && shouldResume) || ((shouldStop || shouldResume) && shouldShowStatus)) {
      throw new Error("Conflicting control flags. Use only one of --stop, --resume, or --status.");
    }

    if (shouldShowStatus) {
      reportAppRunnerStatus();
      log("\n" + "=".repeat(60), colors.bright + colors.green);
      log("  SERVICE STATUS COMPLETE", colors.bright + colors.green);
      log("=".repeat(60), colors.bright + colors.green);
      reportTotalDuration();
      logStream.end();
      return;
    }

    if (shouldStop || shouldResume) {
      const action = shouldStop ? "pause" : "resume";
      controlAppRunnerService(action);
      if (isVerbose) {
        const headline = shouldStop ? "SERVICE STOP REQUEST COMPLETE" : "SERVICE RESUME REQUEST COMPLETE";
        log("\n" + "=".repeat(60), colors.bright + colors.green);
        log(`  ${headline}`, colors.bright + colors.green);
        log("=".repeat(60), colors.bright + colors.green);
        reportTotalDuration();
      }
      logStream.end();
      return;
    }

    if (isQuickDeploy) {
      await quickDeploy();
      log("\n" + "=".repeat(60), colors.bright + colors.green);
      log("  QUICK DEPLOY COMPLETE!", colors.bright + colors.green);
      log("=".repeat(60), colors.bright + colors.green);
      reportTotalDuration();
      logStream.end();
      return;
    }

    // Step 1: Load secrets
    const secrets = loadAllSecrets();
    
    // Step 2: Check prerequisites
    checkPrerequisites();
    
    // Step 2b: Setup S3 bucket and instance role
    const accountId = getAwsAccountId();
    const instanceRoleArn = setupS3AndInstanceRole(accountId);
    
    // Step 3: Smoke tests
    if (skipSmoke) {
      logStep(3, "Smoke tests (skipped)");
      logWarning("Skipping smoke tests (--skip-smoke)");
    } else {
      await runSmokeTests();
    }
    
    // Step 3b: Persist data from running service before rebuilding
    await persistRunningService();
    
    // Step 4: Build Docker image
    const imageTag = buildDockerImage(secrets);
    
    // Step 5: Push to ECR
    const imageUri = pushToECR(imageTag, accountId);
    
    // Step 6: Deploy to App Runner
    const serviceUrl = deployToAppRunner(imageUri, instanceRoleArn);
    
    // Step 7: Wait for deployment to complete
    waitForDeployment();
    
    // Done!
    log("\n" + "=".repeat(60), colors.bright + colors.green);
    log("  DEPLOYMENT COMPLETE!", colors.bright + colors.green);
    log("=".repeat(60), colors.bright + colors.green);
    reportTotalDuration();
    if (serviceUrl) {
      log("");
      log("Access this deployment at:", colors.bright);
      log(serviceUrl, colors.bright + colors.cyan);
    }
    logStream.end();
    
  } catch (error) {
    log("\n" + "=".repeat(60), colors.bright + colors.red);
    log("  DEPLOYMENT FAILED", colors.bright + colors.red);
    log("=".repeat(60), colors.bright + colors.red);
    logError(error.message);
    
    if (isVerbose && error.stack) {
      console.error(error.stack);
      writeToLog(error.stack);
    }
    
    logStream.end();
    process.exit(1);
  }
}

main();
