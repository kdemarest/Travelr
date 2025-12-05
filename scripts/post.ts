/**
 * Simple HTTP POST/GET tester for dev server or production.
 * Handles authentication automatically for known bot users.
 * 
 * Usage:
 *   npx tsx scripts/post.ts [options] <path> [json-body]
 * 
 * Server options (pick one):
 *   -dev     Use local dev server at localhost:4000 (default)
 *   -prod    Use production URL from AWS AppRunner
 * 
 * Auth options (pick one, optional):
 *   -deploybot   Authenticate as deploybot (uses TRAVELR_DEPLOYBOT_PWD)
 *   -testbot     Authenticate as testbot (uses TRAVELR_TESTBOT_PWD)
 * 
 * Examples:
 *   npx tsx scripts/post.ts /ping
 *   npx tsx scripts/post.ts -dev -deploybot /admin/deploy-quick-status
 *   npx tsx scripts/post.ts -prod -deploybot /admin/deploy-quick-status
 *   npx tsx scripts/post.ts -testbot /api/trip/demo/command '{"command":"help"}'
 * 
 * Environment variables:
 *   TRAVELR_DEPLOYBOT_PWD   Password for deploybot user
 *   TRAVELR_TESTBOT_PWD     Password for testbot user
 * 
 * Note: System users (deploybot, testbot) use direct password auth on every request.
 * No session tokens are stored - auth is validated against env vars each time.
 */

import { execSync } from "child_process";

const DEV_URL = "http://localhost:4000";

interface BotConfig {
  user: string;
  envVar: string;
}

const BOTS: Record<string, BotConfig> = {
  deploybot: { user: "deploybot", envVar: "TRAVELR_DEPLOYBOT_PWD" },
  testbot: { user: "testbot", envVar: "TRAVELR_TESTBOT_PWD" },
};

/** Get production URL from AWS AppRunner */
function getProductionUrl(): string {
  const result = execSync(
    'aws apprunner list-services --query "ServiceSummaryList[0].ServiceUrl" --output text',
    { encoding: "utf-8" }
  ).trim();
  if (!result || result === "None") {
    throw new Error("Could not get AppRunner service URL");
  }
  return `https://${result}`;
}

function showUsage(): never {
  console.log("Usage: npx tsx scripts/post.ts [options] <path> [json-body]");
  console.log("");
  console.log("Server options (pick one):");
  console.log("  -dev       Use local dev server at localhost:4000 (default)");
  console.log("  -prod      Use production URL from AWS AppRunner");
  console.log("");
  console.log("Auth options (pick one, optional):");
  console.log("  -deploybot Authenticate as deploybot");
  console.log("  -testbot   Authenticate as testbot");
  console.log("");
  console.log("Examples:");
  console.log("  npx tsx scripts/post.ts /ping");
  console.log("  npx tsx scripts/post.ts -dev -deploybot /admin/deploy-quick-status");
  console.log("  npx tsx scripts/post.ts -prod -deploybot /admin/deploy-quick-status");
  console.log('  npx tsx scripts/post.ts -testbot /api/trip/demo/command \'{"command":"help"}\'');
  console.log("");
  console.log("Environment variables:");
  console.log("  TRAVELR_DEPLOYBOT_PWD   Password for deploybot user");
  console.log("  TRAVELR_TESTBOT_PWD     Password for testbot user");
  process.exit(1);
}

/** Extract a flag from args array, returns true if found. Handles both -flag and --flag=true formats */
function extractFlag(args: string[], flag: string): boolean {
  // Check for -flag format
  const dashIndex = args.indexOf(flag);
  if (dashIndex !== -1) {
    args.splice(dashIndex, 1);
    return true;
  }
  
  // Check for --flag=true format (from MCP tools)
  const doubleDashFlag = `-${flag}=true`;
  const doubleDashIndex = args.indexOf(doubleDashFlag);
  if (doubleDashIndex !== -1) {
    args.splice(doubleDashIndex, 1);
    return true;
  }
  
  return false;
}

async function main() {
  const args = process.argv.slice(2);
  
  // Extract server flags
  const useProd = extractFlag(args, "-prod");
  const useDev = extractFlag(args, "-dev");
  
  // Extract bot flags
  const useDeploybot = extractFlag(args, "-deploybot");
  const useTestbot = extractFlag(args, "-testbot");

  // Validate server flags
  if (useProd && useDev) {
    console.error("Error: Cannot use both -dev and -prod");
    process.exit(1);
  }

  // Validate bot flags
  if (useDeploybot && useTestbot) {
    console.error("Error: Cannot use both -deploybot and -testbot");
    process.exit(1);
  }

  const [path, bodyArg] = args;

  if (!path) {
    showUsage();
  }

  // Determine base URL
  let baseUrl: string;
  if (useProd) {
    console.log("Getting production URL...");
    baseUrl = getProductionUrl();
    console.log(`Production URL: ${baseUrl}`);
  } else {
    baseUrl = DEV_URL;
  }

  // Build headers
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  // System users use direct password auth (no session tokens)
  const botName = useDeploybot ? "deploybot" : useTestbot ? "testbot" : undefined;
  if (botName) {
    const bot = BOTS[botName];
    const password = process.env[bot.envVar];
    if (!password) {
      console.error(`Error: ${bot.envVar} environment variable not set`);
      process.exit(1);
    }
    
    headers["x-auth-user"] = bot.user;
    headers["x-auth-password"] = password;
  }

  const url = `${baseUrl}${path}`;
  const method = bodyArg ? "POST" : "GET";

  const options: RequestInit = {
    method,
    headers,
  };

  if (bodyArg) {
    try {
      // Validate it's valid JSON
      JSON.parse(bodyArg);
      options.body = bodyArg;
    } catch {
      console.error("Error: Body is not valid JSON");
      console.error("Received:", bodyArg);
      process.exit(1);
    }
  }

  console.log(`${method} ${url}`);
  if (bodyArg) {
    console.log(`Body: ${bodyArg}`);
  }
  console.log("---");

  try {
    const response = await fetch(url, options);
    const contentType = response.headers.get("content-type") || "";
    
    let body: unknown;
    if (contentType.includes("application/json")) {
      body = await response.json();
      console.log(`Status: ${response.status}`);
      console.log(JSON.stringify(body, null, 2));
    } else {
      body = await response.text();
      console.log(`Status: ${response.status}`);
      console.log(body);
    }
  } catch (error) {
    if (error instanceof Error && error.cause) {
      const cause = error.cause as { code?: string };
      if (cause.code === "ECONNREFUSED") {
        console.error("Error: Connection refused. Is the dev server running?");
        process.exit(1);
      }
    }
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
