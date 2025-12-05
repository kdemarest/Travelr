/**
 * smoke-tests.ts - Pre-deployment smoke tests
 * 
 * Run health checks and basic tests before deploying.
 */

import { execSync } from "node:child_process";
import { findProjectRoot } from "./ops-config.js";

// ============================================================================
// Types
// ============================================================================

export interface HealthCheckOptions {
  /** URL to check */
  url: string;
  /** Expected response text (default: "pong") */
  expectedText?: string;
  /** Timeout in milliseconds (default: 3000) */
  timeoutMs?: number;
}

export interface SmokeTestOptions {
  /** Run npm test */
  runTests?: boolean;
  /** Check API server health */
  checkApi?: { url: string };
  /** Check web server health */
  checkWeb?: { url: string };
  /** Logging function */
  log?: (message: string) => void;
}

export interface SmokeTestResult {
  ok: boolean;
  tests?: { passed: boolean; error?: string };
  api?: { healthy: boolean };
  web?: { healthy: boolean };
  errors: string[];
}

// ============================================================================
// Health Check
// ============================================================================

/**
 * Check if a URL responds with expected text.
 */
export async function checkHealth(options: HealthCheckOptions): Promise<boolean> {
  const expectedText = options.expectedText ?? "pong";
  const timeoutMs = options.timeoutMs ?? 3000;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    
    const response = await fetch(options.url, { signal: controller.signal });
    clearTimeout(timeout);
    
    const text = await response.text();
    return response.ok && text.trim() === expectedText;
  } catch {
    return false;
  }
}

/**
 * Wait for a URL to become healthy.
 */
export async function waitForHealth(
  options: HealthCheckOptions & { 
    maxAttempts?: number; 
    intervalMs?: number;
    log?: (message: string) => void;
  }
): Promise<boolean> {
  const maxAttempts = options.maxAttempts ?? 10;
  const intervalMs = options.intervalMs ?? 1000;
  const log = options.log ?? (() => {});

  for (let i = 0; i < maxAttempts; i++) {
    if (await checkHealth(options)) {
      return true;
    }
    log(`Waiting for ${options.url}... (${i + 1}/${maxAttempts})`);
    await new Promise(resolve => setTimeout(resolve, intervalMs));
  }
  
  return false;
}

// ============================================================================
// Test Runner
// ============================================================================

/**
 * Run npm test in the project root.
 */
export function runNpmTest(log?: (message: string) => void): { passed: boolean; error?: string } {
  const projectRoot = findProjectRoot();
  log?.("Running npm test...");

  try {
    execSync("npm test", { 
      cwd: projectRoot, 
      encoding: "utf-8", 
      stdio: "pipe" 
    });
    log?.("Tests passed");
    return { passed: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log?.(`Tests failed: ${message}`);
    return { passed: false, error: message };
  }
}

// ============================================================================
// Main
// ============================================================================

/**
 * Run smoke tests before deployment.
 */
export async function runSmokeTests(options: SmokeTestOptions = {}): Promise<SmokeTestResult> {
  const log = options.log ?? (() => {});
  const errors: string[] = [];
  const result: SmokeTestResult = { ok: true, errors };

  // Run unit tests
  if (options.runTests) {
    result.tests = runNpmTest(log);
    if (!result.tests.passed) {
      errors.push("Unit tests failed");
    }
  }

  // Check API health
  if (options.checkApi) {
    log(`Checking API health: ${options.checkApi.url}`);
    const healthy = await checkHealth({ url: options.checkApi.url });
    result.api = { healthy };
    if (healthy) {
      log("API server healthy");
    } else {
      log("API server not responding");
      errors.push("API server health check failed");
    }
  }

  // Check web health
  if (options.checkWeb) {
    log(`Checking web health: ${options.checkWeb.url}`);
    const healthy = await checkHealth({ url: options.checkWeb.url });
    result.web = { healthy };
    if (healthy) {
      log("Web server healthy");
    } else {
      log("Web server not responding");
      errors.push("Web server health check failed");
    }
  }

  result.ok = errors.length === 0;
  return result;
}
