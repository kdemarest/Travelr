#!/usr/bin/env npx tsx
/**
 * Quick test for the deployable zip creation
 * 
 * Can be run from anywhere - uses findProjectRoot() to locate the project.
 */

import path from "node:path";
import fs from "node:fs";

// Dynamic import from project root - works from any directory
async function main() {
  console.log("Testing deployable zip creation...\n");
  
  // Find project root by walking up looking for .jeestyops/config.json
  let dir = process.cwd();
  while (!fs.existsSync(path.join(dir, ".jeestyops", "config.json"))) {
    const parent = path.dirname(dir);
    if (parent === dir) throw new Error("Could not find project root");
    dir = parent;
  }
  const projectRoot = dir;
  console.log(`Project root: ${projectRoot}`);
  
  // Now dynamically import from the found location
  const opsConfigPath = path.join(projectRoot, "ops/src/ops-config.js");
  const createZipPath = path.join(projectRoot, "ops/src/create-deployable-zip.js");
  
  const { opsConfig } = await import(`file://${opsConfigPath.replace(/\\/g, "/")}`);
  const { createDeployableZip } = await import(`file://${createZipPath.replace(/\\/g, "/")}`);
  
  const config = opsConfig();
  console.log(`Include patterns: ${config.deployQuick.include.length}`);
  console.log(`Exclude patterns: ${config.deployQuick.exclude.length}`);
  
  const zipPath = await createDeployableZip({
    projectRoot: config.projectRoot,
    include: config.deployQuick.include,
    exclude: config.deployQuick.exclude,
    outputPath: path.join(config.projectRoot, "dataTemp", "test-deploy.zip")
  });
  
  const stats = fs.statSync(zipPath);
  console.log(`\nCreated: ${zipPath}`);
  console.log(`Size: ${(stats.size / 1024).toFixed(1)} KB`);
  
  // List contents
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip(zipPath);
  const entries = zip.getEntries();
  
  console.log(`\nFiles in zip: ${entries.length}`);
  
  // Group by top-level directory
  const byDir: Record<string, number> = {};
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const topDir = entry.entryName.split("/")[0];
    byDir[topDir] = (byDir[topDir] || 0) + 1;
  }
  
  console.log("\nBy directory:");
  for (const [dir, count] of Object.entries(byDir).sort()) {
    console.log(`  ${dir}: ${count} files`);
  }
  
  // Show first few entries
  console.log("\nSample entries:");
  for (const entry of entries.slice(0, 15)) {
    if (!entry.isDirectory) {
      console.log(`  ${entry.entryName}`);
    }
  }
  if (entries.length > 15) {
    console.log(`  ... and ${entries.length - 15} more`);
  }
}

main().catch(console.error);
