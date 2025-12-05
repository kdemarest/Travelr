/**
 * load-secrets.ts - Load and validate environment variable secrets
 * 
 * Ensures required environment variables are set before deployment.
 */

// ============================================================================
// Types
// ============================================================================

export interface LoadSecretsOptions {
  /** List of env var names to require */
  required: string[];
  /** Optional list of env var names (won't fail if missing) */
  optional?: string[];
  /** Logging function */
  log?: (message: string) => void;
}

export interface LoadSecretsResult {
  ok: boolean;
  secrets: Record<string, string>;
  missing: string[];
}

// ============================================================================
// Main
// ============================================================================

/**
 * Load secrets from environment variables.
 * Returns the values and reports which are missing.
 */
export function loadSecrets(options: LoadSecretsOptions): LoadSecretsResult {
  const log = options.log ?? (() => {});
  const secrets: Record<string, string> = {};
  const missing: string[] = [];

  // Load required secrets
  for (const name of options.required) {
    const value = process.env[name]?.trim();
    if (value) {
      secrets[name] = value;
      log(`${name}: Found (${value.length} chars)`);
    } else {
      missing.push(name);
      log(`${name}: NOT FOUND`);
    }
  }

  // Load optional secrets
  for (const name of options.optional ?? []) {
    const value = process.env[name]?.trim();
    if (value) {
      secrets[name] = value;
      log(`${name}: Found (${value.length} chars)`);
    } else {
      log(`${name}: Not set (optional)`);
    }
  }

  return {
    ok: missing.length === 0,
    secrets,
    missing
  };
}

/**
 * Convenience function: load secrets and throw if any are missing.
 */
export function requireSecrets(options: LoadSecretsOptions): Record<string, string> {
  const result = loadSecrets(options);
  if (!result.ok) {
    const hint = result.missing
      .map(name => `  [Environment]::SetEnvironmentVariable("${name}", "your-value", "User")`)
      .join("\n");
    throw new Error(`Missing required secrets: ${result.missing.join(", ")}\n\nSet them with:\n${hint}`);
  }
  return result.secrets;
}
