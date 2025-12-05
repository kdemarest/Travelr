/**
 * quick-deploy.ts - CLI wrapper for @jeesty/ops deployQuick
 * 
 * Usage:
 *   npx tsx scripts/quick-deploy.ts -prod              # Deploy to production
 *   npx tsx scripts/quick-deploy.ts http://localhost:5000  # Deploy to local
 */

import { deployQuick } from "../ops/src/index.js";

async function main() {
  const arg = process.argv[2];
  
  if (!arg || arg === "-h" || arg === "--help") {
    console.log(`
Usage: npx tsx scripts/quick-deploy.ts <target>

Targets:
  -prod               Deploy to production (auto-detects AWS URL)
  http://localhost:N  Deploy to local dev server
  <url>               Deploy to explicit URL

Requires TRAVELR_DEPLOYBOT_PWD environment variable.
`);
    process.exit(arg ? 0 : 1);
  }
  
  const options = arg === "-prod" 
    ? { local: false }
    : arg.includes("localhost")
      ? { local: true, target: arg }
      : { target: arg };
  
  const result = await deployQuick(options);
  process.exit(result.ok ? 0 : 1);
}

main();
