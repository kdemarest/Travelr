#!/usr/bin/env npx tsx
/**
 * Quick test of createDeployableZip
 */
import { createDeployableZip } from "../ops/src/create-deployable-zip.js";
import { opsConfig } from "../ops/src/ops-config.js";

const config = opsConfig();
console.log("projectRoot:", config.projectRoot);
console.log("include patterns:", JSON.stringify(config.deployQuick.include, null, 2));
console.log("exclude patterns:", JSON.stringify(config.deployQuick.exclude, null, 2));

const zipPath = await createDeployableZip({
  projectRoot: config.projectRoot,
  include: config.deployQuick.include,
  exclude: config.deployQuick.exclude,
  outputPath: config.projectRoot + "/dataTemp/test-zip.zip"
});

console.log("\nCreated:", zipPath);

// Check the size
import fs from "node:fs";
const stats = fs.statSync(zipPath);
console.log("Size:", stats.size, "bytes");
