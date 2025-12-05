/**
 * CLI argument parser for the ops dispatcher.
 * 
 * Supports:
 * - Flags: -quick, --verbose → { quick: true, verbose: true }
 * - Key/value with equals: -port=4000 → { port: "4000" }
 * - Key/value with space: -port 4000 → { port: "4000" }
 * - Lists: -include file1.ts, file2.ts → { include: ["file1.ts", "file2.ts"] }
 */

export interface ParsedArgs {
  group: string;
  flags: Record<string, string | boolean | string[]>;
}

export interface ParseArgsResult {
  parsed: ParsedArgs;
  errors: string[];
}

/**
 * Parse CLI arguments into a structured object.
 * First argument is the group (e.g., "deploy").
 * Remaining arguments are flags and key/value pairs.
 */
export function parseArgs(args: string[]): ParseArgsResult {
  const errors: string[] = [];
  
  if (args.length === 0) {
    return {
      parsed: { group: "", flags: {} },
      errors: ["No command group specified"],
    };
  }

  const group = args[0];
  const flags: Record<string, string | boolean | string[]> = {};
  
  let pendingKey: string | null = null;
  let pendingList: string[] | null = null;

  for (let i = 1; i < args.length; i++) {
    const token = args[i];
    
    if (token.startsWith("-")) {
      // Complete any pending key without value (treat as boolean flag)
      if (pendingKey !== null && pendingList === null) {
        flags[pendingKey] = true;
      }
      // Complete any pending list
      if (pendingList !== null && pendingKey !== null) {
        flags[pendingKey] = pendingList;
        pendingList = null;
      }
      pendingKey = null;

      // Strip leading dashes
      const stripped = token.replace(/^--?/, "");
      
      // Check for equals
      const eqIndex = stripped.indexOf("=");
      if (eqIndex !== -1) {
        const key = normalizeKey(stripped.slice(0, eqIndex));
        const value = stripped.slice(eqIndex + 1);
        
        // Check if value is start of a list
        if (value.endsWith(",")) {
          pendingKey = key;
          pendingList = [value.slice(0, -1)];
        } else {
          flags[key] = value;
        }
      } else {
        // No equals - this might be a flag or a key waiting for a value
        pendingKey = normalizeKey(stripped);
      }
    } else {
      // Value token (no leading dash)
      if (pendingList !== null && pendingKey !== null) {
        // We're building a list
        if (token.endsWith(",")) {
          pendingList.push(token.slice(0, -1));
        } else {
          pendingList.push(token);
          flags[pendingKey] = pendingList;
          pendingList = null;
          pendingKey = null;
        }
      } else if (pendingKey !== null) {
        // Value for the pending key
        if (token.endsWith(",")) {
          // Start of a list
          pendingList = [token.slice(0, -1)];
        } else {
          flags[pendingKey] = token;
          pendingKey = null;
        }
      } else {
        errors.push(`Unexpected value without key: ${token}`);
      }
    }
  }

  // Complete any pending key/list at end
  if (pendingKey !== null) {
    if (pendingList !== null) {
      flags[pendingKey] = pendingList;
    } else {
      flags[pendingKey] = true;
    }
  }

  return {
    parsed: { group, flags },
    errors,
  };
}

/**
 * Normalize a key to camelCase.
 * -skip-smoke becomes skipSmoke
 * -skipSmoke stays skipSmoke
 */
function normalizeKey(key: string): string {
  // Convert kebab-case to camelCase
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}
