/**
 * s3-sync.ts - S3-based persistence for user data
 * 
 * Syncs dataUsers/ and dataTrips/ to/from S3 bucket.
 * 
 * - On startup: downloads from S3 to local
 * - On persist call: uploads local to S3
 * - On interval: uploads local to S3 (configurable)
 * - On shutdown: uploads local to S3
 */

import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

// Directories to sync
const SYNC_DIRS = ["dataUsers", "dataTrips"];

// S3 key for storing file hashes
const HASHES_KEY = ".travelr-hashes.json";

// In-memory hash tracking (populated from S3 on startup)
const fileHashes = new Map<string, string>();

// S3 client (auto-detects credentials from IAM role in prod, or AWS CLI locally)
let s3Client: S3Client | null = null;
let bucketName: string | null = null;
let syncInterval: ReturnType<typeof setInterval> | null = null;

// ============================================================================
// Initialization
// ============================================================================

export function getS3Bucket(): string | null {
  return bucketName;
}

export function isS3Enabled(): boolean {
  return bucketName !== null && s3Client !== null;
}

export function initS3Sync(bucket: string | undefined, region: string = "us-east-1"): void {
  if (!bucket) {
    console.log("[S3Sync] No S3 bucket configured - persistence disabled");
    return;
  }
  
  bucketName = bucket;
  s3Client = new S3Client({ region });
  console.log(`[S3Sync] Initialized with bucket: ${bucket}`);
}

// ============================================================================
// Hash utilities
// ============================================================================

function computeHash(content: string): string {
  return createHash("md5").update(content).digest("hex");
}

async function loadHashesFromS3(): Promise<void> {
  if (!s3Client || !bucketName) return;
  
  try {
    const command = new GetObjectCommand({
      Bucket: bucketName,
      Key: HASHES_KEY
    });
    
    const response = await s3Client.send(command);
    
    if (response.Body) {
      const content = await streamToString(response.Body as NodeJS.ReadableStream);
      const hashes = JSON.parse(content) as Record<string, string>;
      
      fileHashes.clear();
      for (const [key, hash] of Object.entries(hashes)) {
        fileHashes.set(key, hash);
      }
      
      console.log(`[S3Sync] Loaded ${fileHashes.size} file hashes from S3`);
    }
  } catch (error) {
    const err = error as { name?: string };
    if (err.name === "NoSuchKey") {
      console.log("[S3Sync] No hashes file in S3 - starting fresh");
    } else {
      console.error("[S3Sync] Failed to load hashes:", error);
    }
  }
}

async function saveHashesToS3(): Promise<void> {
  if (!s3Client || !bucketName) return;
  
  try {
    const hashes: Record<string, string> = {};
    for (const [key, hash] of fileHashes) {
      hashes[key] = hash;
    }
    
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: HASHES_KEY,
      Body: JSON.stringify(hashes, null, 2),
      ContentType: "application/json"
    });
    
    await s3Client.send(command);
    console.log(`[S3Sync] Saved ${fileHashes.size} file hashes to S3`);
  } catch (error) {
    console.error("[S3Sync] Failed to save hashes:", error);
  }
}

// ============================================================================
// Download from S3
// ============================================================================

async function streamToString(stream: NodeJS.ReadableStream): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf-8");
}

async function downloadFile(key: string, localPath: string): Promise<void> {
  if (!s3Client || !bucketName) return;
  
  try {
    const command = new GetObjectCommand({ Bucket: bucketName, Key: key });
    const response = await s3Client.send(command);
    
    if (response.Body) {
      const content = await streamToString(response.Body as NodeJS.ReadableStream);
      
      // Ensure directory exists
      const dir = path.dirname(localPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      fs.writeFileSync(localPath, content, "utf-8");
      console.log(`[S3Sync] Downloaded: ${key}`);
    }
  } catch (error: unknown) {
    const err = error as { name?: string };
    if (err.name === "NoSuchKey") {
      // File doesn't exist in S3 - that's fine
    } else {
      console.error(`[S3Sync] Failed to download ${key}:`, error);
    }
  }
}

async function listS3Files(prefix: string): Promise<string[]> {
  if (!s3Client || !bucketName) return [];
  
  const keys: string[] = [];
  let continuationToken: string | undefined;
  
  do {
    const command = new ListObjectsV2Command({
      Bucket: bucketName,
      Prefix: prefix,
      ContinuationToken: continuationToken
    });
    
    const response = await s3Client.send(command);
    
    if (response.Contents) {
      for (const item of response.Contents) {
        if (item.Key) {
          keys.push(item.Key);
        }
      }
    }
    
    continuationToken = response.NextContinuationToken;
  } while (continuationToken);
  
  return keys;
}

export async function downloadFromS3(): Promise<number> {
  if (!s3Client || !bucketName) {
    console.log("[S3Sync] S3 not configured - skipping download");
    return 0;
  }
  
  console.log("[S3Sync] Downloading from S3...");
  
  // Load hashes first so we can track what we download
  await loadHashesFromS3();
  
  let count = 0;
  
  for (const dir of SYNC_DIRS) {
    const keys = await listS3Files(`${dir}/`);
    
    for (const key of keys) {
      // Skip "directory" markers
      if (key.endsWith("/")) continue;
      
      const localPath = path.join(process.cwd(), key);
      await downloadFile(key, localPath);
      count++;
    }
  }
  
  console.log(`[S3Sync] Downloaded ${count} files from S3`);
  return count;
}

// ============================================================================
// Upload to S3
// ============================================================================

/**
 * Upload a file to S3 if it has changed.
 * Returns true if the file was uploaded, false if skipped (unchanged).
 */
async function uploadFile(localPath: string, key: string): Promise<boolean> {
  if (!s3Client || !bucketName) return false;
  
  try {
    const content = fs.readFileSync(localPath, "utf-8");
    const newHash = computeHash(content);
    const existingHash = fileHashes.get(key);
    
    // Skip if hash matches
    if (existingHash === newHash) {
      return false;
    }
    
    const command = new PutObjectCommand({
      Bucket: bucketName,
      Key: key,
      Body: content,
      ContentType: "application/json"
    });
    
    await s3Client.send(command);
    
    // Update hash in memory
    fileHashes.set(key, newHash);
    
    console.log(`[S3Sync] Uploaded: ${key}`);
    return true;
  } catch (error) {
    console.error(`[S3Sync] Failed to upload ${key}:`, error);
    throw error;
  }
}

function getLocalFiles(dir: string): string[] {
  const fullPath = path.join(process.cwd(), dir);
  if (!fs.existsSync(fullPath)) return [];
  
  const files: string[] = [];
  
  function walk(currentPath: string, relativePath: string): void {
    const entries = fs.readdirSync(currentPath, { withFileTypes: true });
    
    for (const entry of entries) {
      const entryPath = path.join(currentPath, entry.name);
      const entryRelative = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      
      if (entry.isDirectory()) {
        walk(entryPath, entryRelative);
      } else if (entry.isFile()) {
        files.push(`${dir}/${entryRelative}`);
      }
    }
  }
  
  walk(fullPath, "");
  return files;
}

export async function uploadToS3(): Promise<number> {
  if (!s3Client || !bucketName) {
    console.log("[S3Sync] S3 not configured - skipping upload");
    return 0;
  }
  
  console.log("[S3Sync] Checking for changes...");
  let uploaded = 0;
  let skipped = 0;
  
  for (const dir of SYNC_DIRS) {
    const files = getLocalFiles(dir);
    
    for (const relativePath of files) {
      const localPath = path.join(process.cwd(), relativePath);
      // Use forward slashes for S3 keys
      const key = relativePath.replace(/\\/g, "/");
      const wasUploaded = await uploadFile(localPath, key);
      if (wasUploaded) {
        uploaded++;
      } else {
        skipped++;
      }
    }
  }
  
  // Save updated hashes to S3 if anything was uploaded
  if (uploaded > 0) {
    await saveHashesToS3();
  }
  
  console.log(`[S3Sync] Sync complete: ${uploaded} uploaded, ${skipped} unchanged`);
  return uploaded;
}

// ============================================================================
// Periodic sync
// ============================================================================

export function startPeriodicSync(intervalMinutes: number = 10): void {
  if (!isS3Enabled()) {
    console.log("[S3Sync] Periodic sync disabled - S3 not configured");
    return;
  }
  
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  
  const intervalMs = intervalMinutes * 60 * 1000;
  console.log(`[S3Sync] Starting periodic sync every ${intervalMinutes} minutes`);
  
  syncInterval = setInterval(async () => {
    try {
      await uploadToS3();
    } catch (error) {
      console.error("[S3Sync] Periodic sync failed:", error);
    }
  }, intervalMs);
}

export function stopPeriodicSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
    console.log("[S3Sync] Stopped periodic sync");
  }
}

// ============================================================================
// Shutdown handler
// ============================================================================

export async function shutdownSync(): Promise<void> {
  stopPeriodicSync();
  
  if (isS3Enabled()) {
    console.log("[S3Sync] Shutdown - final upload to S3...");
    try {
      await uploadToS3();
      console.log("[S3Sync] Shutdown sync complete");
    } catch (error) {
      console.error("[S3Sync] Shutdown sync failed:", error);
    }
  }
}
