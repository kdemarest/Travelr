/**
 * Admin API endpoints for file persistence and system management.
 * 
 * GET /admin/files - Download all persistent files as JSON
 * POST /admin/files - Upload and restore persistent files
 * POST /admin/maintenance - Enable/disable maintenance mode
 * POST /admin/persist - Upload local files to S3
 * 
 * Protected by isAdmin check on authenticated user.
 */

import { Router, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { checkIsAdmin, validateAuthKey } from "./auth.js";
import { uploadToS3, isS3Enabled } from "./s3-sync.js";

const router = Router();

const DATA_USERS_DIR = process.env.DATA_USERS_DIR || path.join(process.cwd(), "dataUsers");
const DATA_TRIPS_DIR = process.env.DATA_TRIPS_DIR || path.join(process.cwd(), "dataTrips");

// Maintenance mode - when true, server rejects data-modifying requests
let maintenanceMode = false;

export function isMaintenanceMode(): boolean {
  return maintenanceMode;
}

export function getMaintenanceMessage(): string {
  return "Please wait while the server is being updated. This usually takes about a minute.";
}

interface FileEntry {
  name: string;
  content: string;
}

interface FilesPayload {
  timestamp: string;
  files: FileEntry[];
}

/**
 * Middleware to check admin access.
 * Supports both header auth and query param auth (for deploy script).
 */
function requireAdmin(req: Request, res: Response, next: () => void) {
  // Try headers first, then query params
  const user = (req.headers["x-auth-user"] as string) || (req.query.user as string);
  const deviceId = (req.headers["x-auth-device"] as string) || (req.query.deviceId as string);
  const authKey = (req.headers["x-auth-key"] as string) || (req.query.authKey as string);

  // Validate auth
  const validUser = validateAuthKey(user, deviceId, authKey);
  if (!validUser) {
    return res.status(401).json({ ok: false, error: "Not authenticated" });
  }

  // Check admin
  if (!checkIsAdmin(validUser)) {
    return res.status(403).json({ ok: false, error: "Admin access required" });
  }

  next();
}

/**
 * Read all files from a directory (non-recursive, files only).
 */
function readDirFiles(dir: string, prefix: string = ""): FileEntry[] {
  const files: FileEntry[] = [];
  
  if (!fs.existsSync(dir)) {
    return files;
  }

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isFile()) {
      const filePath = path.join(dir, entry.name);
      const content = fs.readFileSync(filePath, "utf-8");
      files.push({
        name: prefix ? `${prefix}/${entry.name}` : entry.name,
        content
      });
    } else if (entry.isDirectory()) {
      // Recurse into subdirectories
      const subPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
      files.push(...readDirFiles(path.join(dir, entry.name), subPrefix));
    }
  }

  return files;
}

/**
 * GET /admin/files - Download all persistent files
 */
router.get("/files", requireAdmin, (_req: Request, res: Response) => {
  try {
    const files: FileEntry[] = [];

    // Read dataUsers files
    const userFiles = readDirFiles(DATA_USERS_DIR);
    for (const f of userFiles) {
      files.push({ name: `dataUsers/${f.name}`, content: f.content });
    }

    // Read dataTrips files
    const tripFiles = readDirFiles(DATA_TRIPS_DIR);
    for (const f of tripFiles) {
      files.push({ name: `dataTrips/${f.name}`, content: f.content });
    }

    const payload: FilesPayload = {
      timestamp: new Date().toISOString(),
      files
    };

    res.json(payload);
  } catch (error) {
    console.error("Failed to read files:", error);
    res.status(500).json({ error: "Failed to read files" });
  }
});

/**
 * POST /admin/files - Upload and restore persistent files
 */
router.post("/files", requireAdmin, (req: Request, res: Response) => {
  try {
    const payload = req.body as FilesPayload;
    
    if (!payload.files || !Array.isArray(payload.files)) {
      return res.status(400).json({ error: "Invalid payload: expected { files: [...] }" });
    }

    let restored = 0;
    for (const file of payload.files) {
      if (!file.name || typeof file.content !== "string") {
        continue;
      }

      // Determine target directory based on prefix
      let targetPath: string;
      if (file.name.startsWith("dataUsers/")) {
        targetPath = path.join(DATA_USERS_DIR, file.name.replace("dataUsers/", ""));
      } else if (file.name.startsWith("dataTrips/")) {
        targetPath = path.join(DATA_TRIPS_DIR, file.name.replace("dataTrips/", ""));
      } else {
        // Skip unknown prefixes for safety
        console.warn(`Skipping unknown file prefix: ${file.name}`);
        continue;
      }

      // Ensure directory exists
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      // Write file
      fs.writeFileSync(targetPath, file.content, "utf-8");
      restored++;
    }

    res.json({ ok: true, restored, total: payload.files.length });
  } catch (error) {
    console.error("Failed to restore files:", error);
    res.status(500).json({ ok: false, error: "Failed to restore files" });
  }
});

/**
 * POST /admin/maintenance - Enable or disable maintenance mode
 * 
 * Body: { enabled: true/false }
 * 
 * When enabled, the server will reject data-modifying requests with a friendly message.
 * Call this BEFORE /admin/persist during deploy.
 */
router.post("/maintenance", requireAdmin, (req: Request, res: Response) => {
  const { enabled } = req.body as { enabled?: boolean };
  
  if (typeof enabled !== "boolean") {
    return res.status(400).json({ ok: false, error: "Expected { enabled: true/false }" });
  }
  
  maintenanceMode = enabled;
  console.log(`[Admin] Maintenance mode ${enabled ? "ENABLED" : "DISABLED"}`);
  
  res.json({ 
    ok: true, 
    maintenanceMode: enabled,
    message: enabled ? getMaintenanceMessage() : "Server is accepting requests normally"
  });
});

/**
 * POST /admin/persist - Upload local files to S3
 * 
 * Called by deploy script before rebuilding to ensure data is saved.
 */
router.post("/persist", requireAdmin, async (_req: Request, res: Response) => {
  try {
    if (!isS3Enabled()) {
      return res.status(400).json({ 
        ok: false, 
        error: "S3 not configured - set TRAVELR_S3_BUCKET environment variable" 
      });
    }
    
    const filesUploaded = await uploadToS3();
    
    res.json({ 
      ok: true, 
      filesUploaded,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error("Failed to persist to S3:", error);
    res.status(500).json({ ok: false, error: "Failed to persist to S3" });
  }
});

export default router;
