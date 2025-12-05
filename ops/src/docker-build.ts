/**
 * docker-build.ts - Build Docker images
 * 
 * Builds and tags Docker images for deployment.
 */

import { execSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { findProjectRoot } from "./ops-config.js";

// ============================================================================
// Types
// ============================================================================

export interface DockerBuildOptions {
  /** Image name (without tag) */
  imageName: string;
  /** Image tag (default: "latest") */
  tag?: string;
  /** Path to Dockerfile relative to project root (default: "deploy/Dockerfile") */
  dockerfile?: string;
  /** Build context path relative to project root (default: ".") */
  context?: string;
  /** Skip cache (--no-cache flag) */
  noCache?: boolean;
  /** Build arguments */
  buildArgs?: Record<string, string>;
  /** Logging function */
  log?: (message: string) => void;
}

export interface DockerBuildResult {
  ok: boolean;
  imageTag: string;
  /** Image ID (sha256) */
  imageId?: string;
  /** Image creation timestamp */
  createdAt?: string;
  error?: string;
}

/**
 * Get info about a local Docker image.
 */
export function getDockerImageInfo(imageTag: string): { id: string; createdAt: string } | null {
  try {
    const result = execSync(
      `docker inspect ${imageTag} --format "{{.Id}}|{{.Created}}"`,
      { encoding: "utf-8", stdio: "pipe" }
    ).trim();
    const [id, createdAt] = result.split("|");
    return { id, createdAt };
  } catch {
    return null;
  }
}

export interface DockerTagOptions {
  /** Source image (e.g., "myapp:latest") */
  sourceTag: string;
  /** Target image (e.g., "123456789.dkr.ecr.us-east-1.amazonaws.com/myapp:latest") */
  targetTag: string;
  /** Logging function */
  log?: (message: string) => void;
}

// ============================================================================
// Helpers
// ============================================================================

function exec(command: string, log: (msg: string) => void): string {
  log(`$ ${command}`);
  return execSync(command, { encoding: "utf-8", stdio: "pipe" }).trim();
}

// ============================================================================
// Main
// ============================================================================

/**
 * Build a Docker image.
 */
export function dockerBuild(options: DockerBuildOptions): DockerBuildResult {
  const log = options.log ?? (() => {});
  const tag = options.tag ?? "latest";
  const imageTag = `${options.imageName}:${tag}`;
  const projectRoot = findProjectRoot();
  
  const dockerfile = options.dockerfile ?? "deploy/Dockerfile";
  const dockerfilePath = path.join(projectRoot, dockerfile);
  const context = options.context ?? ".";
  const contextPath = path.join(projectRoot, context);

  // Verify Dockerfile exists
  if (!fs.existsSync(dockerfilePath)) {
    return {
      ok: false,
      imageTag,
      error: `Dockerfile not found: ${dockerfilePath}`
    };
  }

  try {
    // Get image info BEFORE build (if image exists)
    const beforeInfo = getDockerImageInfo(imageTag);
    const beforeId = beforeInfo?.id;

    // Build command
    let cmd = `docker build`;
    if (options.noCache) {
      cmd += ` --no-cache`;
    }
    cmd += ` -f "${dockerfilePath}" -t ${imageTag}`;
    
    // Add build args
    if (options.buildArgs) {
      for (const [key, value] of Object.entries(options.buildArgs)) {
        cmd += ` --build-arg ${key}="${value}"`;
      }
    }
    
    cmd += ` "${contextPath}"`;
    
    log(`Building Docker image: ${imageTag}`);
    exec(cmd, log);
    log(`Built: ${imageTag}`);

    // Verify the image was actually rebuilt
    const afterInfo = getDockerImageInfo(imageTag);
    if (beforeId && afterInfo && beforeId === afterInfo.id) {
      log(`⚠️  WARNING: Docker image ID did not change after build!`);
      log(`   This may indicate Docker used cached layers despite --no-cache.`);
      // Note: We don't fail here because sometimes the image legitimately doesn't change
      // (e.g., if no source files changed). The ECR push check will catch real problems.
    }

    return { 
      ok: true, 
      imageTag,
      imageId: afterInfo?.id,
      createdAt: afterInfo?.createdAt
    };
  } catch (error) {
    return {
      ok: false,
      imageTag,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Tag a Docker image with a new name.
 */
export function dockerTag(options: DockerTagOptions): boolean {
  const log = options.log ?? (() => {});
  
  try {
    exec(`docker tag ${options.sourceTag} ${options.targetTag}`, log);
    log(`Tagged: ${options.targetTag}`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if Docker daemon is running.
 */
export function isDockerRunning(): boolean {
  try {
    execSync("docker info", { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Get Docker version.
 */
export function getDockerVersion(): string | null {
  try {
    return execSync("docker --version", { encoding: "utf-8", stdio: "pipe" }).trim();
  } catch {
    return null;
  }
}
