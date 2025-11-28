import cors from "cors";
import express from "express";
import morgan from "morgan";
import path from "node:path";
import { fileURLToPath } from "node:url";
import fs from "fs-extra";
import {
  extractSlashCommandLines,
  formatCanonicalCommand,
  parseCommand,
  type CanonicalCommandContext
} from "./command.js";
import { CommandError, JournalError } from "./errors.js";
import { JournalService } from "./journal.js";
import { TripDocService } from "./tripdoc.js";
import { ConversationStore } from "./conversation.js";
import { generateUid } from "./uid.js";
import { normalizeAllJournals } from "./journal-normalizer.js";
import {
  DEFAULT_MODEL,
  checkOpenAIConnection,
  getActiveModel,
  getAvailableModels,
  sendChatCompletion,
  setActiveModel
} from "./gpt.js";
import { handleGoogleSearch } from "./search.js";
import type { TripModel } from "./types.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataDir = path.resolve(__dirname, "../../data");
const journalService = new JournalService(dataDir);
const tripDocService = new TripDocService(dataDir);
const conversationStore = new ConversationStore(dataDir);

async function ensureDataDir() {
  await fs.ensureDir(dataDir);
}

async function bootstrap() {
  await ensureDataDir();

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  app.use(morgan("dev"));

  app.get("/api/trip/:tripName/model", async (req, res) => {
    const tripName = req.params.tripName;
    const journalPath = path.join(dataDir, `${tripName}.travlrjournal`);
    if (!(await fs.pathExists(journalPath))) {
      return res.status(404).json({ error: `Trip ${tripName} does not exist.` });
    }

    const model = await tripDocService.rebuildModel(tripName);
    res.json(model);
  });

  app.post("/api/trip/:tripName/command", async (req, res) => {
    const tripName = req.params.tripName;
    const { text } = req.body ?? {};
    if (typeof text !== "string") {
      return res.status(400).json({ error: "Payload must include text." });
    }

    const containsWebsearchText = text.includes("/websearch");
    const newlineStats = summarizeLineEndings(text);
    console.log("/command payload diagnostics", {
      tripName,
      totalLength: text.length,
      containsWebsearchText,
      newlineStats
    });
    console.log("/command payload raw JSON", {
      tripName,
      raw: JSON.stringify(text)
    });

    const commandLines = extractSlashCommandLines(text);
    const commandSummary = {
      tripName,
      rawTextLength: text.length,
      commandCount: commandLines.length,
      containsWebsearchLine: commandLines.some((line) => line.includes("/websearch")),
      preview: commandLines.slice(0, 5)
    };
    if (commandLines.length) {
      console.log("/command extracted slash commands", commandSummary);
    } else {
      console.log("/command extracted no slash commands", commandSummary);
    }
    if (commandLines.length === 0) {
      return res.status(200).json({ ok: true, executedCommands: 0, message: "No slash-commands detected." });
    }

    try {
      const parsedCommands = commandLines.map((originalLine) => {
        let context: CanonicalCommandContext | undefined;
        let parsed = parseCommand(originalLine);
        if (parsed.type === "add") {
          if (parsed.uid) {
            throw new CommandError("/add commands cannot specify uid. The server assigns one automatically.");
          }
          const generatedUid = generateUid();
          parsed = { ...parsed, uid: generatedUid };
          context = { ...(context ?? {}), generatedUid };
        }
        return { parsed, context };
      });
      if (parsedCommands.some(({ parsed }) => parsed.type === "help")) {
        return res.status(200).json({ ok: true, executedCommands: 0, message: buildHelpMessage() });
      }

      const tripCommandEntry = parsedCommands.find(({ parsed }) => parsed.type === "trip");
      if (tripCommandEntry && tripCommandEntry.parsed.type === "trip") {
        const tripResponse = await handleTripCommand(tripCommandEntry.parsed.target);
        return res.status(tripResponse.status).json(tripResponse.body);
      }

      const modelCommandEntry = parsedCommands.find(({ parsed }) => parsed.type === "model");
      if (modelCommandEntry && modelCommandEntry.parsed.type === "model") {
        const modelResponse = handleModelCommand(modelCommandEntry.parsed.target);
        return res.status(modelResponse.status).json(modelResponse.body);
      }

      const webSearchCommandEntry = parsedCommands.find(({ parsed }) => parsed.type === "websearch");
      if (webSearchCommandEntry && webSearchCommandEntry.parsed.type === "websearch") {
        console.log("Handling /websearch command", {
          tripName,
          query: webSearchCommandEntry.parsed.query
        });
        const webSearchResponse = await handleWebSearchCommand(webSearchCommandEntry.parsed.query);
        return res.status(webSearchResponse.status).json(webSearchResponse.body);
      }

      const infoCommandEntry = parsedCommands.find(({ parsed }) => parsed.type === "info");
      if (infoCommandEntry && infoCommandEntry.parsed.type === "info") {
        console.log("Handling /info command", {
          tripName,
          topic: infoCommandEntry.parsed.topic ?? "(none)"
        });
        const infoResponse = handleInfoCommand(infoCommandEntry.parsed.topic);
        return res.status(infoResponse.status).json(infoResponse.body);
      }

      const renormalizeCommandEntry = parsedCommands.find(({ parsed }) => parsed.type === "renormalize");
      if (renormalizeCommandEntry) {
        console.log("Handling /renormalize command", { tripName });
        const summary = await normalizeAllJournals(dataDir);
        const successCount = summary.results.length;
        const failureCount = summary.failures.length;
        const messageBase = `Re-normalized ${successCount} of ${summary.discovered} journal${
          summary.discovered === 1 ? "" : "s"
        }.`;
        const message =
          failureCount === 0
            ? messageBase
            : `${messageBase} ${failureCount} file${failureCount === 1 ? "" : "s"} failed.`;

        return res.status(failureCount ? 207 : 200).json({
          ok: failureCount === 0,
          executedCommands: 0,
          message,
          normalized: summary.results.map((result) => ({
            filePath: result.filePath,
            tempPath: result.tempPath,
            normalizedLines: result.normalizedLines,
            skippedLines: result.skippedLines,
            warnings: result.warnings
          })),
          failures: summary.failures
        });
      }

      type TimelineState = { head: number; total: number };
      const timelineStateByTrip = new Map<string, TimelineState>();
      const modelSnapshotsByTrip = new Map<string, TripModel | null>();
      const infoMessages: string[] = [];

      const getTimelineState = async (name: string): Promise<TimelineState> => {
        const existing = timelineStateByTrip.get(name);
        if (existing) {
          return existing;
        }
        const timeline = await tripDocService.getJournalTimeline(name);
        const state: TimelineState = { head: timeline.head, total: timeline.total };
        timelineStateByTrip.set(name, state);
        return state;
      };

      let lastModel = null;
      let executed = 0;
      let currentTripName = tripName;
      const getModelSnapshot = async (name: string): Promise<TripModel | null> => {
        if (modelSnapshotsByTrip.has(name)) {
          return modelSnapshotsByTrip.get(name) ?? null;
        }
        const model = await tripDocService.getExistingModel(name);
        modelSnapshotsByTrip.set(name, model ?? null);
        return model ?? null;
      };

      for (const entry of parsedCommands) {
        const { parsed } = entry;
        const targetTrip = parsed.type === "newtrip" ? parsed.tripId : currentTripName;
        if (parsed.type === "newtrip") {
          currentTripName = parsed.tripId;
        }

        const timelineState = await getTimelineState(targetTrip);

        let deleteContext: CanonicalCommandContext | undefined = entry.context ? { ...entry.context } : undefined;
        if (parsed.type === "delete") {
          const snapshot = await getModelSnapshot(targetTrip);
          const activity = snapshot?.activities.find((item) => item.uid === parsed.uid);
          if (activity) {
            deleteContext = { ...(deleteContext ?? {}), deletedActivity: { ...activity } };
          }
        }

        const canonicalLine = formatCanonicalCommand(parsed, deleteContext);

        if (parsed.type === "undo") {
          const nextHead = Math.max(0, timelineState.head - parsed.count);
          if (nextHead === timelineState.head) {
            infoMessages.push("Nothing to undo.");
            continue;
          }
          timelineState.head = nextHead;
        } else if (parsed.type === "redo") {
          const nextHead = Math.min(timelineState.total, timelineState.head + parsed.count);
          if (nextHead === timelineState.head) {
            infoMessages.push("Nothing to redo.");
            continue;
          }
          timelineState.head = nextHead;
        } else {
          if (timelineState.head < timelineState.total) {
            timelineState.total = timelineState.head;
          }
          timelineState.total += 1;
          timelineState.head = timelineState.total;
        }

        await journalService.appendCommand(targetTrip, parsed, canonicalLine);
        lastModel = await tripDocService.applyCommand(targetTrip, parsed);
        modelSnapshotsByTrip.set(targetTrip, lastModel);
        executed += 1;
      }

      const responseBody: Record<string, unknown> = { ok: true, executedCommands: executed, model: lastModel };
      if (infoMessages.length) {
        responseBody.message = infoMessages.join(" ");
      }
      res.status(201).json(responseBody);
    } catch (error) {
      if (error instanceof CommandError || error instanceof JournalError) {
        return res.status(error.statusCode).json({ error: error.message });
      }

      console.error("Command processing failed", error);
      res.status(500).json({ error: "Internal server error." });
    }
  });

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

  app.post("/api/trip/:tripName/chat", async (req, res) => {
    const tripName = req.params.tripName;
    const { text, conversationHistory, focusSummary } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Payload must include text." });
    }

    const normalizedInput = text.trim();
    const normalizedHistory = typeof conversationHistory === "string" ? conversationHistory : undefined;
    const normalizedFocus = typeof focusSummary === "string" ? focusSummary : undefined;
    console.log("/chat payload received", {
      tripName,
      textLength: normalizedInput.length,
      containsWebsearchText: normalizedInput.includes("/websearch"),
      preview: normalizedInput.slice(0, 200),
      hasConversationHistory: Boolean(normalizedHistory),
      conversationHistoryLength: normalizedHistory?.length ?? 0
    });

    try {
      const model = await tripDocService.getExistingModel(tripName);
      if (!model) {
        return res.status(404).json({ error: `Trip ${tripName} does not exist.` });
      }

      await conversationStore.write(tripName, normalizedHistory ?? "");

      const result = await sendChatCompletion(normalizedInput, {
        temperature: 0.3,
        templateContext: {
          tripModel: model,
          userInput: normalizedInput,
          conversationHistory: normalizedHistory,
          focusSummary: normalizedFocus
        }
      });
      console.log("/chat completion result", {
        tripName,
        model: getActiveModel(),
        responseLength: result.text.length,
        responsePreview: result.text.slice(0, 200),
        containsSlashCommand: result.text.includes("/")
      });

      res.json({ ok: true, text: result.text, model: getActiveModel() });
    } catch (error) {
      console.error("Chat completion failed", error);
      const message = error instanceof Error ? error.message : "Failed to reach OpenAI.";
      res.status(502).json({ error: message });
    }
  });

  const port = Number(process.env.PORT ?? 4000);
  app.listen(port, () => {
    console.log(`Travelr API listening on http://localhost:${port}`);
  });
}

function buildHelpMessage(): string {
  return [
    "Available slash commands:",
    "",
    "/help - Show this list.",
    '/newtrip tripId="<id>" - Required: tripId (letters, numbers, _ or -). Creates or resets the trip.',
    '/add activityType=<flight|lodging|rentalCar|transport|visit|meal|hike> field="value" ... - Required: activityType plus at least one additional field (name=, date=, etc.).',
    '/edit uid=<activity-uid> field="value" ... - Required: uid and at least one field to update. Values use key=value syntax; wrap spaces in quotes.',
    '/delete uid=<activity-uid> - Removes the activity from the trip.',
    '/movedate from="YYYY-MM-DD" to="YYYY-MM-DD" - Move every activity on the from date to the new date.',
    '/trip [tripId] - Without args lists known trips; with tripId it loads that trip for editing.',
    '/model [modelName] - Without args lists supported GPT models; with modelName switches the active model.',
    '/websearch query="search" - Performs a background web search (results currently hidden).',
    '/info [topic] - Placeholder hook for requesting stored user profile info.',
    '/renormalize - Maintenance command that rewrites every journal into canonical form. Run manually; the chatbot never invokes this.'
  ].join("\n");
}

async function handleTripCommand(target?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const trips = await tripDocService.listTrips();
  const listMessage = trips.length ? `Existing trips: ${trips.join(", ")}` : "No trips have been created yet.";

  if (!target) {
    return {
      status: 200,
      body: { ok: true, executedCommands: 0, message: listMessage, trips }
    };
  }

  const model = await tripDocService.getExistingModel(target);
  if (model) {
    return {
      status: 200,
      body: { ok: true, executedCommands: 0, message: `Now editing ${target}`, model, trips }
    };
  }

  return {
    status: 404,
    body: { error: `Trip ${target} not found. ${listMessage}`, trips }
  };
}

function handleModelCommand(target?: string): { status: number; body: Record<string, unknown> } {
  if (!target) {
    const available = getAvailableModels();
    const current = getActiveModel();
    return {
      status: 200,
      body: {
        ok: true,
        executedCommands: 0,
        message: `Available GPT models: ${available.join(", ")}. Active: ${current}.`,
        models: available,
        activeModel: current
      }
    };
  }

  try {
    setActiveModel(target);
    return {
      status: 200,
      body: {
        ok: true,
        executedCommands: 0,
        message: `ChatGPT model set to ${target}.`,
        activeModel: target
      }
    };
  } catch (error) {
    return {
      status: 400,
      body: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}

async function handleWebSearchCommand(query: string): Promise<{ status: number; body: Record<string, unknown> }> {
  try {
    console.log("Starting Google Custom Search", { query });
    const { snippets } = await handleGoogleSearch(query);
    console.log("Google Custom Search finished", { query, snippetCount: snippets.length });
    const count = snippets.length;
    const summary = count === 0
      ? `Web search found no results for "${query}".`
      : `Web search found ${count} result${count === 1 ? "" : "s"} for "${query}".`;
    return {
      status: 200,
      body: {
        ok: true,
        executedCommands: 0,
        message: summary,
        query,
        searchResults: snippets
      }
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

function handleInfoCommand(topic?: string): { status: number; body: Record<string, unknown> } {
  const normalizedTopic = topic?.trim();
  const message = normalizedTopic
    ? `Info command for "${normalizedTopic}" acknowledged. No action taken yet.`
    : "Info command acknowledged. No action taken yet.";
  return {
    status: 200,
    body: {
      ok: true,
      executedCommands: 0,
      message
    }
  };
}

function summarizeLineEndings(value: string) {
  const crlfCount = countOccurrences(value, /\r\n/g);
  const lfCount = countOccurrences(value, /\n/g);
  const crCount = countOccurrences(value, /\r/g);
  const dominantLineEnding = crlfCount > 0 ? "CRLF" : lfCount > 0 ? "LF" : crCount > 0 ? "CR" : "none";
  return { crlfCount, lfCount, crCount, dominantLineEnding };
}

function countOccurrences(value: string, pattern: RegExp): number {
  return value.match(pattern)?.length ?? 0;
}

bootstrap().catch((error) => {
  console.error("Failed to start server", error);
  process.exitCode = 1;
});
