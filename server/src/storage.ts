/**
 * Storage interface for LazyFile and LazyAppendFile.
 * 
 * Abstracts file I/O so we can swap between local filesystem and S3.
 * All methods are async to honestly represent S3's nature.
 */

import fs from "node:fs";
import path from "node:path";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

// ============================================================================
// Storage Interface
// ============================================================================

export interface Storage {
  /** Read file contents. Returns null if file doesn't exist. */
  read(key: string): Promise<string | null>;
  
  /** Write file contents (overwrites if exists). */
  write(key: string, content: string): Promise<void>;
  
  /** Append content to file. */
  append(key: string, content: string): Promise<void>;
  
  /** Check if file exists. */
  exists(key: string): Promise<boolean>;
}

// ============================================================================
// StorageLocal - Local filesystem implementation
// ============================================================================

export class StorageLocal implements Storage {
  constructor(private basePath: string = process.cwd()) {}
  
  private resolvePath(key: string): string {
    return path.join(this.basePath, key);
  }
  
  private ensureDir(filePath: string): void {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  
  async read(key: string): Promise<string | null> {
    const filePath = this.resolvePath(key);
    try {
      return fs.readFileSync(filePath, "utf-8");
    } catch {
      return null;
    }
  }
  
  async write(key: string, content: string): Promise<void> {
    const filePath = this.resolvePath(key);
    this.ensureDir(filePath);
    fs.writeFileSync(filePath, content, "utf-8");
  }
  
  async append(key: string, content: string): Promise<void> {
    const filePath = this.resolvePath(key);
    this.ensureDir(filePath);
    fs.appendFileSync(filePath, content, "utf-8");
  }
  
  async exists(key: string): Promise<boolean> {
    const filePath = this.resolvePath(key);
    return fs.existsSync(filePath);
  }
}

// ============================================================================
// StorageS3 - S3 implementation
// ============================================================================

export class StorageS3 implements Storage {
  private s3Client: S3Client;
  
  constructor(
    private bucket: string,
    private region: string = "us-east-1"
  ) {
    this.s3Client = new S3Client({ region });
  }
  
  async read(key: string): Promise<string | null> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: key
      });
      const response = await this.s3Client.send(command);
      if (response.Body) {
        return await response.Body.transformToString();
      }
      return null;
    } catch (error) {
      const err = error as { name?: string };
      if (err.name === "NoSuchKey") {
        return null; // File doesn't exist
      }
      throw error; // Re-throw other errors
    }
  }
  
  async write(key: string, content: string): Promise<void> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: content,
      ContentType: this.getContentType(key)
    });
    await this.s3Client.send(command);
  }
  
  private getContentType(key: string): string {
    if (key.endsWith(".json")) return "application/json";
    if (key.endsWith(".md")) return "text/markdown";
    return "text/plain";
  }
  
  async append(key: string, content: string): Promise<void> {
    // S3 doesn't support append, so read-modify-write
    const existing = await this.read(key) ?? "";
    await this.write(key, existing + content);
  }
  
  async exists(key: string): Promise<boolean> {
    const content = await this.read(key);
    return content !== null;
  }
  
  getBucket(): string {
    return this.bucket;
  }
}

// ============================================================================
// Global Storage Instances
// ============================================================================

let storageLocal: StorageLocal | null = null;
let storageS3: StorageS3 | null = null;

/**
 * Initialize storage backends. Call once at startup.
 */
export function initStorage(options: {
  basePath?: string;
  s3Bucket?: string;
  s3Region?: string;
}): void {
  storageLocal = new StorageLocal(options.basePath ?? process.cwd());
  
  if (options.s3Bucket) {
    storageS3 = new StorageS3(options.s3Bucket, options.s3Region ?? "us-east-1");
    console.log(`[Storage] S3 storage initialized: ${options.s3Bucket}`);
  }
  
  console.log(`[Storage] Local storage initialized: ${options.basePath ?? process.cwd()}`);
}

/**
 * Get the local storage instance.
 */
export function getStorageLocal(): StorageLocal {
  if (!storageLocal) {
    throw new Error("Storage not initialized. Call initStorage() first.");
  }
  return storageLocal;
}

/**
 * Get the S3 storage instance. Returns null if S3 not configured.
 */
export function getStorageS3(): StorageS3 | null {
  return storageS3;
}

/**
 * Get the appropriate storage for a given key based on environment.
 * In production with S3, user data goes to S3. Config/temp stay local.
 */
export function getStorageFor(key: string): Storage {
  // These always use local storage
  const localOnlyPrefixes = ["dataConfig/", "dataTemp/"];
  
  if (localOnlyPrefixes.some(p => key.startsWith(p))) {
    return getStorageLocal();
  }
  
  // In production with S3, use S3 for everything else
  if (storageS3) {
    return storageS3;
  }
  
  // Fallback to local
  return getStorageLocal();
}
