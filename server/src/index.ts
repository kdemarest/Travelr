import cors from "cors";
import express, { Request, Response, NextFunction } from "express";
import morgan from "morgan";
import path from "node:path";
import fs from "fs-extra";

// Import all command handlers to trigger registration
import "./cmd-add.js";
import "./cmd-addcountry.js";
import "./cmd-delete.js";
import "./cmd-deletealarm.js";
import "./cmd-disablealarm.js";
import "./cmd-edit.js";
import "./cmd-enablealarm.js";
import "./cmd-help.js";
import "./cmd-insertday.js";
import "./cmd-intent.js";
import "./cmd-mark.js";
import "./cmd-model.js";
import "./cmd-moveday.js";
import "./cmd-newtrip.js";
import "./cmd-redo.js";
import "./cmd-refreshcountries.js";
import "./cmd-removeday.js";
import "./cmd-setalarm.js";
import "./cmd-trip.js";
import "./cmd-undo.js";
import "./cmd-userpref.js";
import "./cmd-websearch.js";
import "./cmd-whoami.js";

import { TripCache, initTripCache } from "./trip-cache.js";
import {
  DEFAULT_MODEL,
  checkOpenAIConnection,
  getActiveModel
} from "./gpt.js";
import { loadExchangeRateCatalog, refreshExchangeRateCatalogOnStartup, flushExchangeRateCatalog } from "./exchange.js";
import { createChatHandler } from "./api-chat.js";
import { createCommandRouteHandler } from "./api-command.js";
import { createAlarmsRouter } from "./api-alarms.js";
import { gptQueue } from "./gpt-queue.js";
import { checkSecretsOnStartup } from "./secrets.js";
import { login, authenticateAndFetchUser, authenticateWithPassword, authenticateWithPasswordDebug, authenticateWithBearerToken, logout, isAuthConfigured, initAuth, flushAuth, getLastTripId } from "./auth.js";
import { flushUserPreferences } from "./user-preferences.js";
import { populateBootstrapData } from "./cache-population.js";
import type { User } from "./user.js";
import { createMcpRouter } from "./api-mcp.js";

// Extend Express Request to include authenticated user
export interface AuthenticatedRequest extends Request {
  user: User;
}
import { loadConfig, getServerPort, shouldExpressServeStatic } from "./config.js";
import adminRouter, { isMaintenanceMode, getMaintenanceMessage } from "./api-admin.js";
import { initStorage } from "./storage.js";
import { writePidFile, removePidFile } from "./pid-file.js";
import { Paths } from "./data-paths.js";

const dataTripsDir = Paths.dataTrips;
const clientDistDir = Paths.clientDist;
const tripCache = initTripCache(dataTripsDir);

async function ensureDataDirs() {
  await fs.ensureDir(Paths.dataTrips);
  await fs.ensureDir(Paths.dataDiagnostics);
  await fs.ensureDir(Paths.dataTemp);
}

async function bootstrap() {
  await ensureDataDirs();
  await loadConfig();  // Load config early so other modules can use it
  
  // Initialize storage backends
  const s3Bucket = process.env.TRAVELR_S3_BUCKET;
  initStorage({ s3Bucket });
  
  // Initialize auth module (load user data files)
  await initAuth();
  
  // SECURITY: Verify auth configuration before starting
  // Auth is ALWAYS required - if no users exist, refuse to start
  if (!isAuthConfigured()) {
    console.error("=".repeat(60));
    console.error("FATAL: No users are configured in dataUsers/users.json!");
    console.error("Authentication is always required. Add at least one user.");
    console.error("Refusing to start in an insecure state.");
    console.error("=".repeat(60));
    process.exit(1);
  }
  
  await checkSecretsOnStartup();
  await loadExchangeRateCatalog();
  await refreshExchangeRateCatalogOnStartup();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  app.get("/ping", (_req, res) => {
    res.send("pong");
  });

  // Version endpoint - reports deployed version from version.txt
  app.get("/version", (_req, res) => {
    try {
      const versionPath = path.join(process.cwd(), "version.txt");
      const version = fs.readFileSync(versionPath, "utf-8").trim();
      res.send(version);
    } catch {
      res.send("unknown");
    }
  });

  // Debug endpoint to check what headers are received (before auth)
  app.get("/debug/headers", (req, res) => {
    res.json({
      "x-auth-user": req.headers["x-auth-user"] ?? null,
      "x-auth-password": req.headers["x-auth-password"] ? "[PRESENT]" : null,
      "x-auth-key": req.headers["x-auth-key"] ?? null,
      "authorization": req.headers["authorization"] ? "[PRESENT]" : null,
    });
  });

  // =========================================================================
  // Authentication routes (unprotected - needed to log in)
  // =========================================================================
  
  // Check if auth is required
  app.get("/auth/status", (_req, res) => {
    res.json({ authRequired: true });
  });

  // Validate cached auth key
  app.get("/auth", async (req, res) => {
    const userIdParam = req.query.user as string;
    const deviceId = req.query.deviceId as string;
    const authKey = req.query.authKey as string;
    
    console.log("[GET /auth] validating auth for user:", userIdParam);
    const { valid, user } = authenticateAndFetchUser(userIdParam, deviceId, authKey);
    if (valid && user) {
      const lastTripId = getLastTripId(user.userId);
      
      // Populate bootstrap data for client
      console.log("[GET /auth] populating bootstrap data...");
      await populateBootstrapData(user);
      const clientDataCache = user.clientDataCache.getData();
      console.log("[GET /auth] clientDataCache to send:", JSON.stringify(clientDataCache));
      
      res.json({ ok: true, userId: user.userId, lastTripId, clientDataCache });
    } else {
      console.log("[GET /auth] auth invalid");
      res.status(401).json({ ok: false, error: "Invalid or expired auth key" });
    }
  });

  // Login with username/password
  app.post("/auth", async (req, res) => {
    const { user: userId, password, deviceId, deviceInfo } = req.body;
    
    if (!userId || !password) {
      return res.status(400).json({ ok: false, error: "Missing user or password" });
    }
    
    if (!deviceId) {
      return res.status(400).json({ ok: false, error: "Missing deviceId" });
    }
    
    // Get client IP (handles proxies)
    const ip = (req.headers["x-forwarded-for"] as string)?.split(",")[0]?.trim() 
      || req.socket.remoteAddress 
      || "";
    
    const authKey = await login(userId, password, deviceId, deviceInfo || "", ip);
    if (authKey) {
      // Get the User object to populate bootstrap data
      const { user } = authenticateAndFetchUser(userId, deviceId, authKey);
      const lastTripId = getLastTripId(userId);
      
      if (user) {
        await populateBootstrapData(user);
        const clientDataCache = user.clientDataCache.getData();
        res.json({ ok: true, user: userId, authKey, lastTripId, clientDataCache });
      } else {
        res.json({ ok: true, user: userId, authKey, lastTripId });
      }
    } else {
      res.status(401).json({ ok: false, error: "Invalid username or password" });
    }
  });

  // Logout
  app.post("/auth/logout", (req, res) => {
    const userId = req.query.userId as string || req.body.userId;
    const deviceId = req.query.deviceId as string || req.body.deviceId;
    if (userId && deviceId) {
      logout(userId, deviceId);
    }
    res.json({ ok: true });
  });

  // =========================================================================
  // MCP endpoint for ChatGPT connectors (no auth for now)
  // =========================================================================
  app.use("/mcp", createMcpRouter());

  // =========================================================================
  // Static file serving - BEFORE auth so the login page can load
  // The client app handles showing the login screen when API calls return 401
  // =========================================================================
  if (shouldExpressServeStatic()) {
    console.log(`Serving static files from ${clientDistDir}`);
    app.use(express.static(clientDistDir));
  }

  // =========================================================================
  // Auth middleware - protects EVERYTHING below this point
  // Supports four modes:
  // 1. Token auth: x-auth-user + x-auth-key (+ optional x-auth-device)
  // 2. Direct password auth: x-auth-user + x-auth-password (for single API calls)
  // 3. Basic auth: Authorization: Basic base64(user:password)
  // 4. Bearer auth: Authorization: Bearer <authKey>
  // =========================================================================
  
  const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
    let userHeader = req.headers["x-auth-user"] as string || req.query.user as string;
    let password = req.headers["x-auth-password"] as string;
    const authKey = req.headers["x-auth-key"] as string || req.query.authKey as string;
    const deviceId = req.headers["x-auth-device"] as string || req.query.deviceId as string;
    
    const authHeader = req.headers["authorization"] as string;

    // Build debug context for auth failures
    const debugContext = {
      path: req.path,
      method: req.method,
      hasUserHeader: !!userHeader,
      userHeader: userHeader || null,
      hasPassword: !!password,
      passwordLength: password?.length ?? 0,
      hasAuthKey: !!authKey,
      hasDeviceId: !!deviceId,
      hasAuthHeader: !!authHeader,
      authHeaderType: authHeader?.split(" ")[0] ?? null,
    };
    
    // Check for Bearer auth: Authorization: Bearer <authKey>
    if (authHeader?.startsWith("Bearer ")) {
      const bearerToken = authHeader.slice(7);
      const user = authenticateWithBearerToken(bearerToken);
      if (user) {
        (req as AuthenticatedRequest).user = user;
        return next();
      }
      return res.status(401).json({ ok: false, error: "Invalid bearer token", debug: debugContext });
    }
    
    // Check for Basic auth header: Authorization: Basic base64(user:password)
    if (authHeader?.startsWith("Basic ")) {
      try {
        const base64 = authHeader.slice(6);
        const decoded = Buffer.from(base64, "base64").toString("utf-8");
        const colonIndex = decoded.indexOf(":");
        if (colonIndex > 0) {
          userHeader = decoded.slice(0, colonIndex);
          password = decoded.slice(colonIndex + 1);
          debugContext.userHeader = userHeader;
          debugContext.hasUserHeader = true;
          debugContext.hasPassword = true;
          debugContext.passwordLength = password.length;
        }
      } catch {
        // Ignore malformed Basic auth, fall through to other methods
      }
    }
    
    // Try direct password auth first (for single API calls from scripts)
    if (userHeader && password) {
      const result = await authenticateWithPasswordDebug(userHeader, password);
      if (result.user) {
        (req as AuthenticatedRequest).user = result.user;
        return next();
      }
      return res.status(401).json({ 
        ok: false, 
        error: "Invalid username or password",
        debug: { ...debugContext, ...result.debug }
      });
    }
    
    // Fall back to token-based auth
    const { valid, user } = authenticateAndFetchUser(userHeader, deviceId, authKey);
    if (valid && user) {
      // Attach user to request for downstream handlers
      (req as AuthenticatedRequest).user = user;
      return next();
    }
    
    // Not authenticated - return 401 with full debug info
    res.status(401).json({ 
      ok: false, 
      error: "Authentication required",
      debug: {
        ...debugContext,
        reason: !userHeader ? "No user header" : !password && !authKey ? "No password or auth key" : "Token auth failed",
      }
    });
  };

  // Apply auth middleware globally (everything after this requires auth)
  app.use(requireAuth);

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

  app.use(checkMaintenance);

  // =========================================================================
  // Admin routes (protected by isAdmin check)
  // =========================================================================
  app.use("/admin", adminRouter);

  // Simple auth test endpoint
  app.get("/api/testauth", (_req, res) => {
    res.send("success");
  });

  // Mount alarms router (for mobile app polling)
  app.use("/api", createAlarmsRouter(tripCache));

  app.post("/api/trip/:tripName/command", createCommandRouteHandler(tripCache));

  app.get("/api/gpt/health", async (_req, res) => {
    try {
      await checkOpenAIConnection();
      const model = getActiveModel();
      res.json({ ok: true, model, message: `ChatGPT ${model} connected.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      res.status(502).json({ ok: false, error: message });
    }
  });

  app.get("/api/trip/:tripName/conversation", async (req, res) => {
    const tripName = req.params.tripName;
    try {
      const trip = await tripCache.getTrip(tripName);
      const history = trip.conversation.read();
      res.json({ ok: true, history });
    } catch (error) {
      console.error("Failed to read conversation history", { tripName, error });
      res.status(500).json({ ok: false, error: "Failed to load conversation history." });
    }
  });

  app.post("/api/trip/:tripName/chat", createChatHandler(tripCache));

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

  // SPA fallback - serve index.html for any unmatched routes (in production)
  if (shouldExpressServeStatic()) {
    app.get("/{*splat}", (_req, res) => {
      res.sendFile(path.join(clientDistDir, "index.html"));
    });
  }

  const port = getServerPort();
  const server = app.listen(port, () => {
    console.log(`Travelr API listening on http://localhost:${port}`);
    
    // Write PID file for quick deploy detection
    writePidFile();
  });
  
  // Graceful shutdown handler
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down gracefully...`);
    
    // Remove PID file first (signals to relaunch script we're shutting down)
    removePidFile();
    
    // Flush pending writes
    await flushAuth();
    await flushUserPreferences();
    await flushExchangeRateCatalog();
    await tripCache.flushAllTrips();
    
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
