/**
 * filePersist.ts - Download/upload persistent files from/to running Travelr server
 * 
 * Used to preserve user data across container redeploys since App Runner
 * containers have ephemeral storage.
 * 
 * Usage:
 *   npx ts-node scripts/filePersist.ts --download --url https://myapp.awsapprunner.com --user admin --password secret
 *   npx ts-node scripts/filePersist.ts --upload --url https://myapp.awsapprunner.com --user admin --password secret
 *   npx ts-node scripts/filePersist.ts --upload --url https://myapp.awsapprunner.com --user admin --password secret --cache dataCache/TravelrFiles-2024-01-15T12-00-00
 */

import * as fs from "fs";
import * as path from "path";

// ============================================================================
// Types
// ============================================================================

interface FileEntry {
  name: string;    // relative path like "dataUsers/users.json"
  content: string; // file content
}

interface FilesPayload {
  timestamp: string;
  files: FileEntry[];
}

interface ApiResponse {
  ok: boolean;
  error?: string;
  authKey?: string;
  data?: FilesPayload;
}

interface Args {
  mode: "download" | "upload";
  url: string;
  user: string;
  password: string;
  cache?: string; // for upload: specific cache folder to use
}

// ============================================================================
// Helpers
// ============================================================================

function parseArgs(): Args {
  const args = process.argv.slice(2);
  
  let mode: "download" | "upload" | undefined;
  let url: string | undefined;
  let user: string | undefined;
  let password: string | undefined;
  let cache: string | undefined;
  
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--download") {
      mode = "download";
    } else if (arg === "--upload") {
      mode = "upload";
    } else if (arg === "--url" && args[i + 1]) {
      url = args[++i];
    } else if (arg === "--user" && args[i + 1]) {
      user = args[++i];
    } else if (arg === "--password" && args[i + 1]) {
      password = args[++i];
    } else if (arg === "--cache" && args[i + 1]) {
      cache = args[++i];
    }
  }
  
  if (!mode) {
    console.error("Error: Must specify --download or --upload");
    printUsage();
    process.exit(1);
  }
  
  if (!url) {
    console.error("Error: Must specify --url <server-url>");
    printUsage();
    process.exit(1);
  }
  
  if (!user || !password) {
    console.error("Error: Must specify --user <username> --password <password>");
    printUsage();
    process.exit(1);
  }
  
  return { mode, url, user, password, cache };
}

function printUsage(): void {
  console.log(`
Usage:
  npx ts-node scripts/filePersist.ts --download --url <server> --user <user> --password <pass>
  npx ts-node scripts/filePersist.ts --upload --url <server> --user <user> --password <pass> [--cache <folder>]

Options:
  --download    Download files from server and save to dataCache/
  --upload      Upload files to server from dataCache/
  --url         Server URL (e.g., https://myapp.awsapprunner.com)
  --user        Admin username
  --password    Admin password
  --cache       For upload: specific cache folder to use (defaults to most recent)
`);
}

function getDeviceId(): string {
  return "filePersist-script";
}

async function login(url: string, user: string, password: string): Promise<string> {
  const deviceId = getDeviceId();
  const loginUrl = `${url}/auth/login`;
  
  console.log(`Logging in as ${user}...`);
  
  const response = await fetch(loginUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user, password, deviceId }),
  });
  
  const data: ApiResponse = await response.json();
  
  if (!data.ok || !data.authKey) {
    throw new Error(`Login failed: ${data.error || "Unknown error"}`);
  }
  
  console.log("Login successful.");
  return data.authKey;
}

function getCacheDir(): string {
  return path.join(process.cwd(), "dataCache");
}

function findMostRecentCache(): string | null {
  const cacheDir = getCacheDir();
  if (!fs.existsSync(cacheDir)) return null;
  
  const entries = fs.readdirSync(cacheDir, { withFileTypes: true });
  const folders = entries
    .filter(e => e.isDirectory() && e.name.startsWith("TravelrFiles-"))
    .map(e => e.name)
    .sort()
    .reverse();
  
  return folders.length > 0 ? path.join(cacheDir, folders[0]) : null;
}

// ============================================================================
// Download
// ============================================================================

async function downloadFiles(args: Args): Promise<void> {
  const authKey = await login(args.url, args.user, args.password);
  const deviceId = getDeviceId();
  
  const filesUrl = `${args.url}/admin/files?user=${encodeURIComponent(args.user)}&deviceId=${encodeURIComponent(deviceId)}&authKey=${encodeURIComponent(authKey)}`;
  
  console.log("Downloading files from server...");
  
  const response = await fetch(filesUrl);
  const data: ApiResponse = await response.json();
  
  if (!data.ok || !data.data) {
    throw new Error(`Download failed: ${data.error || "Unknown error"}`);
  }
  
  const payload = data.data;
  console.log(`Received ${payload.files.length} files (timestamp: ${payload.timestamp})`);
  
  // Create cache folder
  const safestamp = payload.timestamp.replace(/[:.]/g, "-");
  const cacheFolder = path.join(getCacheDir(), `TravelrFiles-${safestamp}`);
  
  if (!fs.existsSync(cacheFolder)) {
    fs.mkdirSync(cacheFolder, { recursive: true });
  }
  
  // Write files
  for (const file of payload.files) {
    const filePath = path.join(cacheFolder, file.name);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, file.content, "utf-8");
    console.log(`  Saved: ${file.name}`);
  }
  
  // Save metadata
  const metaPath = path.join(cacheFolder, "metadata.json");
  fs.writeFileSync(metaPath, JSON.stringify({
    downloadedAt: new Date().toISOString(),
    serverUrl: args.url,
    timestamp: payload.timestamp,
    fileCount: payload.files.length,
  }, null, 2));
  
  console.log(`\nFiles saved to: ${cacheFolder}`);
}

// ============================================================================
// Upload
// ============================================================================

function readCacheFiles(cacheFolder: string): FileEntry[] {
  const files: FileEntry[] = [];
  
  function readDir(dir: string, relativeBase: string): void {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = relativeBase ? `${relativeBase}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        readDir(fullPath, relativePath);
      } else if (entry.isFile() && entry.name !== "metadata.json") {
        // Normalize path to forward slashes
        const normalizedPath = relativePath.replace(/\\/g, "/");
        files.push({
          name: normalizedPath,
          content: fs.readFileSync(fullPath, "utf-8"),
        });
      }
    }
  }
  
  // Only read dataUsers and dataTrips subdirectories
  for (const subdir of ["dataUsers", "dataTrips"]) {
    const subdirPath = path.join(cacheFolder, subdir);
    if (fs.existsSync(subdirPath)) {
      readDir(subdirPath, subdir);
    }
  }
  
  return files;
}

async function uploadFiles(args: Args): Promise<void> {
  // Find cache folder
  let cacheFolder: string | undefined = args.cache;
  if (!cacheFolder) {
    const mostRecent = findMostRecentCache();
    if (!mostRecent) {
      throw new Error("No cache folder found. Run --download first or specify --cache.");
    }
    cacheFolder = mostRecent;
    console.log(`Using most recent cache: ${cacheFolder}`);
  }
  
  if (!fs.existsSync(cacheFolder)) {
    throw new Error(`Cache folder not found: ${cacheFolder}`);
  }
  
  // Read files from cache
  const files = readCacheFiles(cacheFolder);
  if (files.length === 0) {
    throw new Error("No files found in cache folder.");
  }
  console.log(`Found ${files.length} files to upload.`);
  
  // Login
  const authKey = await login(args.url, args.user, args.password);
  const deviceId = getDeviceId();
  
  // Upload
  const filesUrl = `${args.url}/admin/files?user=${encodeURIComponent(args.user)}&deviceId=${encodeURIComponent(deviceId)}&authKey=${encodeURIComponent(authKey)}`;
  
  const payload: FilesPayload = {
    timestamp: new Date().toISOString(),
    files,
  };
  
  console.log("Uploading files to server...");
  
  const response = await fetch(filesUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  
  const data: ApiResponse = await response.json();
  
  if (!data.ok) {
    throw new Error(`Upload failed: ${data.error || "Unknown error"}`);
  }
  
  console.log("Upload successful!");
  for (const file of files) {
    console.log(`  Uploaded: ${file.name}`);
  }
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();
  
  try {
    if (args.mode === "download") {
      await downloadFiles(args);
    } else {
      await uploadFiles(args);
    }
  } catch (error) {
    console.error(`Error: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

main();
