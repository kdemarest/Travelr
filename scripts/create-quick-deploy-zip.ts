#!/usr/bin/env npx tsx
/**
 * create-quick-deploy-zip.ts - Create a deployment zip for quick deploy
 * 
 * Creates a zip containing all source files needed for a quick deploy.
 * Used by deploy.js for quick deploys and by test scripts.
 * 
 * Uses adm-zip for both creation and extraction (relaunch.ts uses same library).
 * 
 * IMPORTANT: Caller MUST provide sourceRoot - this script has no opinion about
 * where source code lives. The caller always knows their context.
 * 
 * Usage: 
 *   npx tsx scripts/create-quick-deploy-zip.ts <sourceRoot> [outputPath]
 *   
 * Example:
 *   npx tsx scripts/create-quick-deploy-zip.ts . ./my-deploy.zip
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Create a deployment zip containing source files for quick deploy.
 * 
 * @param sourceRoot - The root directory containing source code to zip (REQUIRED)
 * @param outputPath - Where to write the zip (optional, defaults to sourceRoot/dataTemp/)
 * @returns Path to the created zip file
 */
export async function createDeploymentZip(sourceRoot: string, outputPath?: string): Promise<string> {
  if (!sourceRoot) {
    throw new Error("sourceRoot is required - caller must specify where source code lives");
  }
  
  const resolvedRoot = path.resolve(sourceRoot);
  const zipPath = outputPath || path.join(resolvedRoot, "dataTemp", "quick-deploy-outbound.zip");
  
  // Ensure dataTemp directory exists
  const dataTemp = path.dirname(zipPath);
  if (!fs.existsSync(dataTemp)) {
    fs.mkdirSync(dataTemp, { recursive: true });
  }
  
  const zip = new AdmZip();
  
  // Whitelist approach: only include *.ts, *.svg, package*.json, tsconfig*.json, 
  // index.html, vite.config.ts, and prompt-template.md
  const allowedExtensions = [".ts", ".svg"];
  const allowedFiles = ["package.json", "package-lock.json", "tsconfig.json", "index.html"];
  
  function shouldInclude(filePath: string): boolean {
    // Exclude TEST_* directories anywhere in the path
    if (/[/\\]TEST_/.test(filePath) || path.basename(filePath).startsWith("TEST_")) {
      return false;
    }
    const ext = path.extname(filePath);
    const base = path.basename(filePath);
    return allowedExtensions.includes(ext) || allowedFiles.includes(base);
  }
  
  function addDirectory(dirPath: string, zipDir: string): void {
    if (!fs.existsSync(dirPath)) return;
    
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      const nextZipDir = path.posix.join(zipDir, entry.name);
      
      if (entry.isDirectory()) {
        // Skip TEST_* directories
        if (entry.name.startsWith("TEST_")) continue;
        addDirectory(fullPath, nextZipDir);
      } else if (shouldInclude(fullPath)) {
        zip.addLocalFile(fullPath, zipDir);
      }
    }
  }
  
  // Source directories (filtered to whitelist)
  addDirectory(path.join(resolvedRoot, "server", "src"), "server/src");
  addDirectory(path.join(resolvedRoot, "client", "src"), "client/src");
  addDirectory(path.join(resolvedRoot, "scripts"), "scripts");
  
  // Root package files
  zip.addLocalFile(path.join(resolvedRoot, "package.json"), "");
  zip.addLocalFile(path.join(resolvedRoot, "package-lock.json"), "");
  zip.addLocalFile(path.join(resolvedRoot, "tsconfig.base.json"), "");
  
  // Server package/config
  zip.addLocalFile(path.join(resolvedRoot, "server", "package.json"), "server");
  zip.addLocalFile(path.join(resolvedRoot, "server", "tsconfig.json"), "server");
  
  // Client package/config/build
  zip.addLocalFile(path.join(resolvedRoot, "client", "package.json"), "client");
  zip.addLocalFile(path.join(resolvedRoot, "client", "tsconfig.json"), "client");
  zip.addLocalFile(path.join(resolvedRoot, "client", "index.html"), "client");
  zip.addLocalFile(path.join(resolvedRoot, "client", "vite.config.ts"), "client");
  
  // Prompt template (used by chatbot)
  zip.addLocalFile(path.join(resolvedRoot, "dataConfig", "prompt-template.md"), "dataConfig");
  
  zip.writeZip(zipPath);
  return zipPath;
}

// Run standalone if executed directly
const runningDirectly = process.argv[1]?.includes("create-quick-deploy-zip");
if (runningDirectly) {
  const sourceRoot = process.argv[2];
  const outputPath = process.argv[3];
  
  if (!sourceRoot) {
    console.error("Usage: npx tsx scripts/create-quick-deploy-zip.ts <sourceRoot> [outputPath]");
    process.exit(1);
  }
  
  createDeploymentZip(sourceRoot, outputPath)
    .then(zipPath => {
      const stats = fs.statSync(zipPath);
      console.log(zipPath);
      console.error(`Created ${(stats.size / 1024).toFixed(1)} KB`);
    })
    .catch(err => {
      console.error("Failed to create zip:", err);
      process.exit(1);
    });
}
