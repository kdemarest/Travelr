import cors from "cors";
import express from "express";
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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../../trips");
const journalService = new JournalService(dataDir);
const tripDocService = new TripDocService(dataDir);
const conversationStore = new ConversationStore(dataDir);

async function ensureDataDir() {
  await fs.ensureDir(dataDir);
}

async function bootstrap() {
  await ensureDataDir();
  await refreshExchangeRateCatalogOnStartup();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  app.post("/api/trip/:tripName/command", createCommandRouteHandler(tripDocService, journalService, conversationStore, dataDir));

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

  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => {
    console.log(`Travelr API listening on http://localhost:${port}`);
  });
}

bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exitCode = 1;
});
