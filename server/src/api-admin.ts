/**
 * Admin API endpoints for file persistence and system management.
 * 
 * GET /admin/files - Download all persistent files as JSON
 * POST /admin/files - Upload and restore persistent files
 * POST /admin/maintenance - Enable/disable maintenance mode
 * POST /admin/deploy-quick - Receive zip, extract, build, restart server
 * GET /admin/deploy-quick-status - Get the most recent deploy-quick log file
 * 
 * Protected by isAdmin check on authenticated user.
 */

import { Router, Request, Response } from "express";
import fs from "node:fs";
import path from "node:path";
import { isDeployQuickAllowed, isTestMode } from "./config.js";
import { Paths } from "./data-paths.js";
import { removePidFile } from "./pid-file.js";
import { handleDeployQuick } from "@jeesty/ops";
import type { AuthenticatedRequest } from "./index.js";

const router = Router();

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
 * User is already authenticated by requireAuth middleware in index.ts.
 */
function requireAdmin(req: Request, res: Response, next: () => void) {
  const user = (req as AuthenticatedRequest).user;
  
  if (!user.isAdmin) {
    return res.status(403).json({ ok: false, error: "Admin access required" });
  }

  next();
}

/**
 * GET /admin/testauth - Simple admin auth test endpoint
 */
router.get("/testauth", requireAdmin, (_req: Request, res: Response) => {
  res.send("success");
});

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
    const userFiles = readDirFiles(Paths.dataUsers);
    for (const f of userFiles) {
      files.push({ name: `dataUsers/${f.name}`, content: f.content });
    }

    // Read dataTrips files
    const tripFiles = readDirFiles(Paths.dataTrips);
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
      // WARNING: users.json contains password hashes - never allow overwriting via this endpoint
      if (file.name === "dataUsers/users.json") {
        console.warn("Skipping users.json - cannot overwrite password file via API");
        continue;
      }

      let targetPath: string;
      if (file.name.startsWith("dataUsers/")) {
        targetPath = path.join(Paths.dataUsers, file.name.replace("dataUsers/", ""));
      } else if (file.name.startsWith("dataTrips/")) {
        targetPath = path.join(Paths.dataTrips, file.name.replace("dataTrips/", ""));
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
 * Use this to alert clients before maintenance operations like deploys.
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
 * POST /admin/deploy-quick - Receive deployment zip and restart server
 * 
 * Server stays running while extracting, building, then restarts.
 * This keeps health checks happy throughout the process.
 * 
 * Requires:
 * - isAdmin user
 * - deployQuickAllowed: true in config
 * 
 * Body: raw zip file (application/zip or application/octet-stream)
 */
router.post("/deploy-quick", requireAdmin, async (req: Request, res: Response) => {
  const testMode = req.query.test === "true";
  const dryRun = req.query.dryRun === "true";
  
  // Security check: must be explicitly enabled in config (unless test mode)
  if (!testMode && !isDeployQuickAllowed()) {
    console.error("[DeployQuick] REJECTED - deployQuickAllowed is not true in config");
    return res.status(403).json({ 
      ok: false, 
      error: "Deploy-quick is not enabled on this server. Set deployQuickAllowed: true in config." 
    });
  }
  
  try {
    // Get expected MD5 from header
    const expectedMd5 = req.headers["x-content-md5"] as string | undefined;
    if (!expectedMd5) {
      return res.status(400).json({ ok: false, error: "Missing X-Content-MD5 header" });
    }
    
    // Get raw body as buffer
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(chunk as Buffer);
    }
    const zipBuffer = Buffer.concat(chunks);
    
    if (zipBuffer.length === 0) {
      return res.status(400).json({ ok: false, error: "No zip data received" });
    }
    
    // Validate it looks like a zip (starts with PK)
    if (zipBuffer[0] !== 0x50 || zipBuffer[1] !== 0x4B) {
      return res.status(400).json({ ok: false, error: "Invalid zip file (bad magic bytes)" });
    }
    
    console.log(`[DeployQuick] Received ${zipBuffer.length} bytes, MD5: ${expectedMd5}`);
    
    // Perform the deploy-quick (extract, build, restart)
    // Pass server-specific values to the ops handler
    const result = await handleDeployQuick({
      zipBuffer,
      expectedMd5,
      dataRoot: Paths.dataRoot,
      diagnosticsDir: Paths.dataDiagnostics,
      triggerRestart: () => {
        removePidFile();
        process.exit(99);
      },
      testMode,
      dryRun,
      skipNpmInstall: isTestMode() // Skip npm install in test environments
    });
    
    if (result.ok) {
      res.json({
        ok: true,
        message: result.message,
        fileCount: result.fileCount,
        logFile: result.logFile,
        testMode,
        dryRun
      });
    } else {
      res.status(500).json({
        ok: false,
        error: result.error,
        logFile: result.logFile
      });
    }
    
  } catch (error) {
    console.error("[DeployQuick] Failed:", error);
    res.status(500).json({ ok: false, error: `Deploy quick failed: ${error}` });
  }
});

/**
 * GET /admin/deploy-quick-status - Get the most recent deploy-quick log file
 * 
 * Returns the contents of the most recent deploy-quick-*.log file from dataDiagnostics.
 * Useful for diagnosing what happened during a deploy-quick.
 */
router.get("/deploy-quick-status", requireAdmin, (_req: Request, res: Response) => {
  try {
    if (!fs.existsSync(Paths.dataDiagnostics)) {
      return res.status(404).json({ ok: false, error: "No diagnostics directory found" });
    }
    
    // Find all deploy-quick-*.log files
    const files = fs.readdirSync(Paths.dataDiagnostics)
      .filter(f => f.startsWith("deploy-quick-") && f.endsWith(".log"))
      .sort()
      .reverse(); // Most recent first (lexicographic sort works for ISO timestamps)
    
    if (files.length === 0) {
      return res.status(404).json({ ok: false, error: "No deploy-quick logs found" });
    }
    
    const latestLog = files[0];
    const logPath = path.join(Paths.dataDiagnostics, latestLog);
    const content = fs.readFileSync(logPath, "utf-8");
    
    res.setHeader("Content-Type", "text/plain");
    res.send(content);
  } catch (error) {
    console.error("[DeployQuickStatus] Failed:", error);
    res.status(500).json({ ok: false, error: `Failed to read log: ${error}` });
  }
});

export default router;
