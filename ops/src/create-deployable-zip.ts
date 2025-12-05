/**
 * create-deployable-zip.ts - Create deployment zip for quick deploy
 * 
 * Creates a zip containing files matching a whitelist of patterns.
 * Patterns support:
 *   - Exact files: "package.json", "server/tsconfig.json"
 *   - Wildcards: "*.ts", "*.json"
 *   - Directory wildcards: "server/src/**" (all files in directory recursively)
 *   - Combined: "client/*.ts" (all .ts files in client/)
 */

import fs from "node:fs";
import path from "node:path";

export interface CreateDeployableZipOptions {
  /** Root directory to zip from */
  projectRoot: string;
  /** Patterns for files to include */
  include: string[];
  /** Patterns for files/directories to exclude */
  exclude: string[];
  /** Output zip path (defaults to projectRoot/dataTemp/deployable.zip) */
  outputPath?: string;
}

/**
 * Check if a path matches a glob-like pattern.
 * Supports:
 *   - Exact match: "package.json"
 *   - Extension wildcard: "*.ts" (matches .ts files anywhere)
 *   - Directory wildcard: "server/src/**" (all files under that path)
 *   - Path with extension: "client/*.json" (direct children only)
 */
function matchesPattern(relativePath: string, pattern: string): boolean {
  // Normalize separators
  const normalizedPath = relativePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");
  
  // Exact match
  if (normalizedPath === normalizedPattern) {
    return true;
  }
  
  // Directory recursive wildcard: "dir/**" matches anything under dir/
  if (normalizedPattern.endsWith("/**")) {
    const dirPrefix = normalizedPattern.slice(0, -2); // Remove **
    if (normalizedPath.startsWith(dirPrefix)) {
      return true;
    }
  }
  
  // Extension wildcard: "*.ts" matches any .ts file at any depth
  if (normalizedPattern.startsWith("*.")) {
    const ext = normalizedPattern.slice(1); // ".ts"
    if (normalizedPath.endsWith(ext)) {
      return true;
    }
  }
  
  // Path with extension wildcard: "client/*.json" (direct children only)
  if (normalizedPattern.includes("/*.") && !normalizedPattern.includes("**")) {
    const slashStar = normalizedPattern.lastIndexOf("/*.");
    const dirPart = normalizedPattern.slice(0, slashStar + 1); // "client/"
    const extPart = normalizedPattern.slice(slashStar + 2);     // ".json"
    
    if (normalizedPath.startsWith(dirPart) && normalizedPath.endsWith(extPart)) {
      // Make sure it's directly in that directory, not a subdirectory
      const remainder = normalizedPath.slice(dirPart.length);
      if (!remainder.includes("/")) {
        return true;
      }
    }
  }
  
  // Single * wildcard in filename: "tsconfig*.json"
  if (normalizedPattern.includes("*") && !normalizedPattern.includes("**") && !normalizedPattern.startsWith("*.")) {
    const regex = new RegExp("^" + normalizedPattern.replace(/\./g, "\\.").replace(/\*/g, ".*") + "$");
    if (regex.test(normalizedPath)) {
      return true;
    }
  }
  
  return false;
}

/**
 * Check if a path should be excluded.
 */
function isExcluded(relativePath: string, fileName: string, excludePatterns: string[]): boolean {
  for (const pattern of excludePatterns) {
    // Direct name match (for directories like "node_modules")
    if (fileName === pattern) {
      return true;
    }
    // Pattern match
    if (matchesPattern(relativePath, pattern)) {
      return true;
    }
    // Check if any parent directory matches
    const parts = relativePath.split(/[/\\]/);
    for (const part of parts) {
      if (part === pattern) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Check if a file should be included based on patterns.
 */
function shouldIncludeFile(relativePath: string, includePatterns: string[]): boolean {
  for (const pattern of includePatterns) {
    if (matchesPattern(relativePath, pattern)) {
      return true;
    }
  }
  return false;
}

/**
 * Recursively collect all files from a directory.
 */
function collectFiles(
  dirPath: string, 
  projectRoot: string,
  includePatterns: string[],
  excludePatterns: string[]
): { fullPath: string; relativePath: string }[] {
  const results: { fullPath: string; relativePath: string }[] = [];
  
  if (!fs.existsSync(dirPath)) {
    return results;
  }
  
  const entries = fs.readdirSync(dirPath, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(projectRoot, fullPath).replace(/\\/g, "/");
    
    if (isExcluded(relativePath, entry.name, excludePatterns)) {
      continue;
    }
    
    if (entry.isDirectory()) {
      results.push(...collectFiles(fullPath, projectRoot, includePatterns, excludePatterns));
    } else if (shouldIncludeFile(relativePath, includePatterns)) {
      results.push({ fullPath, relativePath });
    }
  }
  
  return results;
}

/**
 * Create a deployable zip from files matching the whitelist patterns.
 * 
 * @param options - Configuration for what to include/exclude
 * @returns Path to the created zip file
 */
export async function createDeployableZip(options: CreateDeployableZipOptions): Promise<string> {
  const { projectRoot, include, exclude, outputPath } = options;
  
  const AdmZip = (await import("adm-zip")).default;
  const zip = new AdmZip();
  
  const zipPath = outputPath ?? path.join(projectRoot, "dataTemp", "deployable.zip");
  
  // Ensure output directory exists
  const zipDir = path.dirname(zipPath);
  if (!fs.existsSync(zipDir)) {
    fs.mkdirSync(zipDir, { recursive: true });
  }
  
  // Collect all matching files
  const files = collectFiles(projectRoot, projectRoot, include, exclude);
  
  // Add files to zip
  for (const file of files) {
    const zipEntryDir = path.dirname(file.relativePath);
    zip.addLocalFile(file.fullPath, zipEntryDir === "." ? "" : zipEntryDir);
  }
  
  zip.writeZip(zipPath);
  return zipPath;
}
