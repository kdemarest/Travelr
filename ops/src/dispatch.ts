/**
 * dispatch.ts - Main CLI dispatcher for @jeesty/ops
 * 
 * Entry point for all ops commands. Loads config, parses args, 
 * looks up the command in the registry, and calls the function.
 * 
 * Usage: npx tsx ops/src/dispatch.ts deploy -quick
 */

import { opsConfig, ensureProjectRoot, type OpsConfig } from "./ops-config.js";
import { parseArgs } from "./parse-args.js";
import { opRegistry } from "./op-registry.js";

// Import dispatch-registry to trigger all registrations
import "./dispatch-registry.js";

// ============================================================================
// Helpers
// ============================================================================

/**
 * Get a value from an object by dot-separated path.
 * e.g., getByPath(obj, "aws.region") → obj.aws.region
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  
  for (const part of parts) {
    if (current === null || current === undefined) {
      return undefined;
    }
    if (typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  
  return current;
}

/**
 * Extract config values using paramMap.
 * Only extracts params with non-empty config paths (skips CLI-only params).
 */
function extractFromConfig(
  config: OpsConfig,
  paramMap: Record<string, string>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  
  for (const [paramName, configPath] of Object.entries(paramMap)) {
    if (configPath) {  // Skip empty = CLI-only params
      result[paramName] = getByPath(config as unknown as Record<string, unknown>, configPath);
    }
  }
  
  return result;
}

/**
 * Create a logger function for the command.
 */
function createLogger(): (msg: string) => void {
  return (msg: string) => console.log(msg);
}

/**
 * Show help for a command group.
 */
function showHelp(group: string): void {
  const commands = opRegistry.getForGroup(group);
  
  if (commands.length === 0) {
    console.log(`Unknown command group: ${group}`);
    console.log(`Available groups: ${opRegistry.getGroups().join(", ")}`);
    process.exit(1);
  }
  
  console.log(`\nUsage: ${group} [options]\n`);
  console.log("Options:");
  
  for (const cmd of commands) {
    console.log(`  -${cmd.flag.padEnd(12)} ${cmd.description}`);
  }
  
  console.log(`  -help         Show this help\n`);
  
  // Collect all examples
  const examples = commands.flatMap(cmd => cmd.examples ?? []);
  if (examples.length > 0) {
    console.log("Examples:");
    for (const ex of examples.slice(0, 5)) {  // Show first 5
      console.log(`  ${ex}`);
    }
  }
  
  console.log();
}

// ============================================================================
// Main Dispatch
// ============================================================================

async function dispatch(args: string[]): Promise<void> {
  // Parse CLI args
  const { parsed, errors } = parseArgs(args);
  
  if (errors.length > 0) {
    for (const err of errors) {
      console.error(`Error: ${err}`);
    }
    process.exit(1);
  }
  
  const { group, flags } = parsed;
  
  if (!group) {
    console.log("Usage: <group> -<command> [options]");
    console.log(`Available groups: ${opRegistry.getGroups().join(", ")}`);
    process.exit(1);
  }
  
  // Check for help
  if (flags.help || flags.h) {
    showHelp(group);
    process.exit(0);
  }
  
  // Check group exists
  if (!opRegistry.hasGroup(group)) {
    console.error(`Unknown command group: ${group}`);
    console.log(`Available groups: ${opRegistry.getGroups().join(", ")}`);
    process.exit(1);
  }
  
  // Find which flag identifies the command
  const flag = opRegistry.findFlag(group, flags);
  
  if (!flag) {
    console.error(`No command flag specified for group: ${group}`);
    showHelp(group);
    process.exit(1);
  }
  
  // Lookup registration
  const reg = opRegistry.get(group, flag);
  
  if (!reg) {
    console.error(`Unknown command: ${group} -${flag}`);
    process.exit(1);
  }
  
  // Ensure we're running from project root before doing anything else
  ensureProjectRoot();
  
  // Load config
  let config: OpsConfig;
  try {
    config = opsConfig();
  } catch (err) {
    console.error(`Config error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
  
  // Extract config values using paramMap
  const configValues = extractFromConfig(config, reg.paramMap);
  
  // Merge: config values, then CLI overrides, then logger
  const params: Record<string, unknown> = {
    ...configValues,
    ...flags,
    log: createLogger(),
  };
  
  // Call the function
  try {
    const result = await reg.fn(params);
    
    // If result has useful info, log it
    if (result !== undefined && result !== null) {
      if (typeof result === "object" && "message" in result) {
        console.log((result as { message: string }).message);
      }
    }
    
    process.exit(0);
  } catch (err) {
    console.error(`Error: ${err instanceof Error ? err.message : err}`);
    process.exit(1);
  }
}

// ============================================================================
// Entry Point
// ============================================================================

// Get args after "dispatch.ts"
const args = process.argv.slice(2);
dispatch(args);
