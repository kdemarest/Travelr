/**
 * ops-config.ts - Configuration loader for @jeesty/ops
 * 
 * Loads .jeestyops/config.json from the project root.
 * Walks up directories until it finds the config file.
 */

import fs from "node:fs";
import path from "node:path";

// ============================================================================
// Types
// ============================================================================

export interface OpsConfigAws {
  region: string;
  s3Bucket: string;
}

export interface OpsConfigHealthCheck {
  path: string;
  expected: string;
}

export interface OpsConfigContainer {
  port: number;
  healthCheck: OpsConfigHealthCheck;
}

export interface OpsConfigAuth {
  user: string;
  passwordEnvVar: string;
  endpoint: string;
}

export interface OpsConfigDeployQuick {
  endpoint: string;
  restartExitCode: number;
  include: string[];
  exclude: string[];
}

export interface OpsConfig {
  name: string;
  aws: OpsConfigAws;
  container: OpsConfigContainer;
  auth: OpsConfigAuth;
  deployQuick: OpsConfigDeployQuick;
  secrets: string[];
  
  // Computed at load time
  projectRoot: string;
}

// ============================================================================
// Project Root Detection
// ============================================================================

const CONFIG_DIR = ".jeestyops";
const CONFIG_FILENAME = "config.json";

/**
 * Find the project root by walking up directories looking for dataConfig/.
 * 
 * dataConfig/ is the definitive marker for a project root - it contains
 * the server configuration and must exist for any deployment to work.
 * This works for both real projects and TEST_* sandboxes (which copy dataConfig/).
 * 
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns Absolute path to project root
 * @throws If no project root found
 */
export function findProjectRoot(startDir?: string): string {
  const searchDir = startDir ?? process.cwd();
  let dir = path.resolve(searchDir);
  const root = path.parse(dir).root;
  
  while (dir !== root) {
    const dataConfigPath = path.join(dir, "dataConfig");
    if (fs.existsSync(dataConfigPath) && fs.statSync(dataConfigPath).isDirectory()) {
      return dir;
    }
    dir = path.dirname(dir);
  }
  
  throw new Error(
    `Could not find project root (no dataConfig/ found in ${searchDir} or any parent directory)`
  );
}

/**
 * Ensure we're running from the project root directory.
 * Changes process.cwd() to the project root if we're not already there.
 * 
 * Call this at the start of any ops command to ensure consistent behavior
 * regardless of where the command was invoked from.
 * 
 * @returns The project root path (also now the cwd)
 */
export function ensureProjectRoot(): string {
  const projectRoot = findProjectRoot();
  if (process.cwd() !== projectRoot) {
    process.chdir(projectRoot);
  }
  return projectRoot;
}

// ============================================================================
// Config Loading
// ============================================================================

/**
 * Find the config file by walking up directories from startDir.
 * Returns the path to the config file, or null if not found.
 */
function findConfigFile(startDir: string): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  
  while (dir !== root) {
    const configPath = path.join(dir, CONFIG_DIR, CONFIG_FILENAME);
    if (fs.existsSync(configPath)) {
      return configPath;
    }
    dir = path.dirname(dir);
  }
  
  return null;
}

/**
 * Validate the config object has all required fields.
 * Throws if validation fails.
 */
function validateConfig(config: unknown, configPath: string): asserts config is Omit<OpsConfig, "projectRoot"> {
  if (typeof config !== "object" || config === null) {
    throw new Error(`${configPath}: Config must be an object`);
  }
  
  const c = config as Record<string, unknown>;
  
  // Required top-level fields
  if (typeof c.name !== "string") {
    throw new Error(`${configPath}: Missing or invalid 'name' (string required)`);
  }
  
  // AWS
  if (typeof c.aws !== "object" || c.aws === null) {
    throw new Error(`${configPath}: Missing 'aws' section`);
  }
  const aws = c.aws as Record<string, unknown>;
  if (typeof aws.region !== "string") {
    throw new Error(`${configPath}: Missing aws.region`);
  }
  if (typeof aws.s3Bucket !== "string") {
    throw new Error(`${configPath}: Missing aws.s3Bucket`);
  }
  
  // Container
  if (typeof c.container !== "object" || c.container === null) {
    throw new Error(`${configPath}: Missing 'container' section`);
  }
  const container = c.container as Record<string, unknown>;
  if (typeof container.port !== "number") {
    throw new Error(`${configPath}: Missing container.port`);
  }
  if (typeof container.healthCheck !== "object" || container.healthCheck === null) {
    throw new Error(`${configPath}: Missing container.healthCheck`);
  }
  const hc = container.healthCheck as Record<string, unknown>;
  if (typeof hc.path !== "string" || typeof hc.expected !== "string") {
    throw new Error(`${configPath}: Invalid container.healthCheck (need path and expected)`);
  }
  
  // Auth
  if (typeof c.auth !== "object" || c.auth === null) {
    throw new Error(`${configPath}: Missing 'auth' section`);
  }
  const auth = c.auth as Record<string, unknown>;
  if (typeof auth.user !== "string") {
    throw new Error(`${configPath}: Missing auth.user`);
  }
  if (typeof auth.passwordEnvVar !== "string") {
    throw new Error(`${configPath}: Missing auth.passwordEnvVar`);
  }
  if (typeof auth.endpoint !== "string") {
    throw new Error(`${configPath}: Missing auth.endpoint`);
  }
  
  // Deploy Quick
  if (typeof c.deployQuick !== "object" || c.deployQuick === null) {
    throw new Error(`${configPath}: Missing 'deployQuick' section`);
  }
  const dq = c.deployQuick as Record<string, unknown>;
  if (typeof dq.endpoint !== "string") {
    throw new Error(`${configPath}: Missing deployQuick.endpoint`);
  }
  if (typeof dq.restartExitCode !== "number") {
    throw new Error(`${configPath}: Missing deployQuick.restartExitCode`);
  }
  if (!Array.isArray(dq.include)) {
    throw new Error(`${configPath}: Missing deployQuick.include array`);
  }
  if (!Array.isArray(dq.exclude)) {
    throw new Error(`${configPath}: Missing deployQuick.exclude array`);
  }
  
  // Secrets
  if (!Array.isArray(c.secrets)) {
    throw new Error(`${configPath}: Missing 'secrets' array`);
  }
}

/**
 * Load the ops config from jeesty-ops-config.json.
 * 
 * Also ensures we're running from the project root directory.
 * This is the SINGLE POINT where all ops code gets rooted properly.
 * 
 * @param startDir - Directory to start searching from (defaults to cwd)
 * @returns The loaded and validated config
 * @throws If config file not found or invalid
 */
export function opsConfig(startDir?: string): OpsConfig {
  // First, ensure we're at project root
  ensureProjectRoot();
  
  const searchDir = startDir ?? process.cwd();
  const configPath = findConfigFile(searchDir);
  
  if (!configPath) {
    throw new Error(
      `Could not find ${CONFIG_FILENAME} in ${searchDir} or any parent directory`
    );
  }
  
  const content = fs.readFileSync(configPath, "utf-8");
  let parsed: unknown;
  
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`${configPath}: Invalid JSON - ${err}`);
  }
  
  validateConfig(parsed, configPath);
  
  // Add computed projectRoot (parent of .jeestyops directory)
  const config: OpsConfig = {
    ...parsed,
    projectRoot: path.dirname(path.dirname(configPath))
  };
  
  return config;
}

/**
 * Get the production URL from AWS App Runner.
 */
export async function getProductionUrl(config: OpsConfig): Promise<string> {
  const { execSync } = await import("node:child_process");
  
  const cmd = `aws apprunner list-services --region ${config.aws.region} --query "ServiceSummaryList[?ServiceName=='${config.name}'].ServiceUrl" --output text`;
  
  const result = execSync(cmd, { encoding: "utf-8" }).trim();
  
  if (!result || result === "None") {
    throw new Error(`No App Runner service found for '${config.name}'`);
  }
  
  return `https://${result}`;
}
