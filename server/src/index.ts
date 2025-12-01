import cors from "cors";
import express, { Request, Response, NextFunction } from "express";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import { JournalService } from "./journal.js";
import { TripDocService } from "./tripdoc.js";
import { ConversationStore } from "./conversation.js";
import {
  DEFAULT_MODEL,
  checkOpenAIConnection
} from "./gpt.js";
import { refreshExchangeRateCatalogOnStartup } from "./exchange.js";
import { createChatHandler } from "./api-chat.js";
import { createCommandRouteHandler } from "./api-command.js";
import { gptQueue } from "./gpt-queue.js";
import { checkSecretsOnStartup } from "./secrets.js";
import { login, validateAuthKey, logout, isAuthEnabled, getDevices } from "./auth.js";
import { loadConfig, getServerPort, shouldExpressServeStatic } from "./config.js";
import adminRouter, { isMaintenanceMode, getMaintenanceMessage } from "./api-admin.js";
import { initS3Sync, downloadFromS3, startPeriodicSync, shutdownSync } from "./s3-sync.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataTripsDir = path.resolve(__dirname, "../../dataTrips");
const dataConfigDir = path.resolve(__dirname, "../../dataConfig");
const clientDistDir = path.resolve(__dirname, "../../client/dist");
const journalService = new JournalService(dataTripsDir);
const tripDocService = new TripDocService(dataTripsDir);
const conversationStore = new ConversationStore(dataTripsDir);

async function ensureDataDir() {
  await fs.ensureDir(dataTripsDir);
}

async function bootstrap() {
  await ensureDataDir();
  await loadConfig();  // Load config early so other modules can use it
  
  // Initialize S3 sync if configured
  const s3Bucket = process.env.TRAVELR_S3_BUCKET;
  initS3Sync(s3Bucket);
  
  // Download data from S3 on startup (before loading any data)
  if (s3Bucket) {
    await downloadFromS3();
  }
  
  await checkSecretsOnStartup();
  await refreshExchangeRateCatalogOnStartup();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  app.get("/ping", (_req, res) => {
    res.send("pong");
  });

  // =========================================================================
  // Authentication routes (unprotected)
  // =========================================================================
  
  // Check if auth is required
  app.get("/auth/status", (_req, res) => {
    res.json({ authRequired: isAuthEnabled() });
  });

  // Validate cached auth key
  app.get("/auth", (req, res) => {
    const user = req.query.user as string;
    const deviceId = req.query.deviceId as string;
    const authKey = req.query.authKey as string;
    
    const validUser = validateAuthKey(user, deviceId, authKey);
    if (validUser) {
      res.json({ ok: true, user: validUser });
    } else {
      res.status(401).json({ ok: false, error: "Invalid or expired auth key" });
    }
  });

  // Login with username/password
  app.post("/auth", async (req, res) => {
    const { user, password, deviceId, deviceInfo } = req.body;
    
    if (!user || !password) {
      return res.status(400).json({ ok: false, error: "Missing user or password" });
    }
    
    if (!deviceId) {
      return res.status(400).json({ ok: false, error: "Missing deviceId" });
    }
    
    // Get client IP (handles proxies)
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() 
      || req.socket.remoteAddress 
      || "";
    
    const authKey = await login(user, password, deviceId, deviceInfo || "", ip);
    if (authKey) {
      res.json({ ok: true, user, authKey });
    } else {
      res.status(401).json({ ok: false, error: "Invalid username or password" });
    }
  });

  // Logout
  app.post("/auth/logout", (req, res) => {
    const user = req.query.user as string || req.body.user;
    const deviceId = req.query.deviceId as string || req.body.deviceId;
    if (user && deviceId) {
      logout(user, deviceId);
    }
    res.json({ ok: true });
  });

  // List devices for a user (requires valid auth)
  app.get("/auth/devices", (req, res) => {
    const user = req.query.user as string;
    const deviceId = req.query.deviceId as string;
    const authKey = req.query.authKey as string;
    
    const validUser = validateAuthKey(user, deviceId, authKey);
    if (!validUser) {
      return res.status(401).json({ ok: false, error: "Authentication required" });
    }
    
    const devices = getDevices(validUser);
    res.json({ ok: true, devices });
  });

  // =========================================================================
  // Admin routes (protected by isAdmin check)
  // =========================================================================
  app.use("/admin", adminRouter);

  // =========================================================================
  // Auth middleware - protects all /api/* routes
  // =========================================================================
  
  const requireAuth = (req: Request, res: Response, next: NextFunction) => {
    // Skip auth if no users configured
    if (!isAuthEnabled()) {
      return next();
    }
    
    // Check for auth in headers or query params
    const authKey = req.headers["x-auth-key"] as string || req.query.authKey as string;
    const user = req.headers["x-auth-user"] as string || req.query.user as string;
    const deviceId = req.headers["x-auth-device"] as string || req.query.deviceId as string;
    
    if (validateAuthKey(user, deviceId, authKey)) {
      return next();
    }
    
    res.status(401).json({ ok: false, error: "Authentication required" });
  };

  // Maintenance mode check - block data-modifying requests during deploy
  const checkMaintenance = (req: Request, res: Response, next: NextFunction) => {
    // Only block POST/PUT/PATCH/DELETE - allow GET for status checks
    if (isMaintenanceMode() && req.method !== "GET") {
      return res.status(503).json({ 
        ok: false, 
        maintenance: true,
        message: getMaintenanceMessage()
      });
    }
    next();
  };

  // Apply auth middleware to all API routes
  app.use("/api", requireAuth);
  app.use("/api", checkMaintenance);

  app.post("/api/trip/:tripName/command", createCommandRouteHandler(tripDocService, journalService, conversationStore, dataTripsDir));

  app.get("/api/gpt/health", async (_req, res) => {
    try {
      await checkOpenAIConnection();
      res.json({ ok: true, model: DEFAULT_MODEL, message: `ChatGPT ${DEFAULT_MODEL} connected.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(502).json({ ok: false, error: message });
    }
  });

  app.get("/api/trip/:tripName/conversation", async (req, res) => {
    const tripName = req.params.tripName;
    try {
      const history = await conversationStore.read(tripName);
      res.json({ ok: true, history });
    } catch (error) {
      console.error("Failed to read conversation history", { tripName, error });
      res.status(500).json({ ok: false, error: "Failed to load conversation history." });
    }
  });

  app.post("/api/trip/:tripName/chat", createChatHandler(tripDocService, conversationStore));

  // Poll for chained GPT response by GUID
  app.get("/api/chain/:guid", async (req, res) => {
    const guid = req.params.guid;
    
    if (!gptQueue.has(guid)) {
      return res.status(404).json({ error: "GPT task not found or already retrieved." });
    }
    
    try {
      const result = await gptQueue.fetch(guid);
      if (!result) {
        return res.status(404).json({ error: "GPT task expired." });
      }
      
      res.json({
        ok: !result.error,
        text: result.text,
        model: result.model,
        executedCommands: result.executedCommands,
        updatedModel: result.updatedModel,
        chatbotActivityMarks: result.markedActivities,
        chatbotDateMarks: result.markedDates,
        pendingChatbot: result.nextGuid,
        error: result.error
      });
    } catch (error) {
      console.error("Failed to fetch GPT result", { guid, error });
      res.status(500).json({ error: "Failed to retrieve GPT response." });
    }
  });

  // Serve static files in production (when Vite isn't running)
  if (shouldExpressServeStatic()) {
    console.log(`Serving static files from ${clientDistDir}`);
    app.use(express.static(clientDistDir));
    
    // SPA fallback - serve index.html for any unmatched routes
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(clientDistDir, "index.html"));
    });
  }

  const port = getServerPort();
  const server = app.listen(port, () => {
    console.log(`Travelr API listening on http://localhost:${port}`);
    
    // Start periodic S3 sync (every 10 minutes)
    if (process.env.TRAVELR_S3_BUCKET) {
      startPeriodicSync(10);
    }
  });
  
  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    
    // Final S3 sync
    await shutdownSync();
    
    server.close(() => {
      console.log("Server closed");
      process.exit(0);
    });
    
    // Force exit after 10 seconds
    setTimeout(() => {
      console.error("Forced shutdown after timeout");
      process.exit(1);
    }, 10000);
  };
  
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exitCode = 1;
});
