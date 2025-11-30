import type { Request, Response } from "express";
import { formatCanonicalCommand, parseCommand, type CanonicalCommandContext, type ParsedCommand } from "./command.js";
import { CommandError, JournalError } from "./errors.js";
import type { JournalService } from "./journal.js";
import type { ConversationStore } from "./conversation.js";
import { TripDocService, computeJournalTimeline, type JournalEntry } from "./tripdoc.js";
import { generateUid } from "./uid.js";
import type { TripModel } from "./types.js";
import { finalizeModel } from "./finalize-model.js";
import { parseChatPieces, isCommandPiece, hasProse } from "./chat-pieces.js";
import { normalizeCommandLine, augmentCommandLine } from "./normalize.js";
import { cmdHelp, type CommandResponse } from "./cmd-help.js";
import { cmdTrip } from "./cmd-trip.js";
import { cmdModel } from "./cmd-model.js";
import { cmdWebsearch } from "./cmd-websearch.js";
import { cmdUserpref } from "./cmd-userpref.js";
import { cmdRefreshcountries } from "./cmd-refreshcountries.js";
import { cmdRenormalize } from "./cmd-renormalize.js";
import { ensureCountryMetadata } from "./country.js";
import { enqueueGptTask, type ChatbotContext } from "./chatbot.js";
import { recordRequest } from "./gpt.js";

type TimelineState = { head: number; total: number; orderedIndexes: number[]; entries: JournalEntry[] };

// Shared context passed to all command handlers
interface CommandContext {
  tripDocService: TripDocService;
  journalService: JournalService;
  dataDir: string;
  currentTripName: string;
  timelineStateByTrip: Map<string, TimelineState>;
  modelSnapshotsByTrip: Map<string, TripModel | null>;
  infoMessages: string[];
  lastModel: TripModel | null;
  lastModelTripName: string | null;
  executed: number;
}

// Result from processing a single command
interface CommandResult {
  // For non-journalable commands that produce a response
  response?: CommandResponse;
  // Updated parsed command (e.g., after addcountry enrichment)
  parsed: ParsedCommand;
  // Whether this command was journaled
  journaled: boolean;
}

async function getTimelineState(
  ctx: CommandContext,
  tripName: string
): Promise<TimelineState> {
  const existing = ctx.timelineStateByTrip.get(tripName);
  if (existing) {
    return existing;
  }
  const entries = await ctx.tripDocService.getJournalEntries(tripName);
  const timeline = computeJournalTimeline(entries);
  const state: TimelineState = {
    head: timeline.head,
    total: timeline.total,
    orderedIndexes: timeline.orderedIndexes.slice(),
    entries: [...entries]
  };
  ctx.timelineStateByTrip.set(tripName, state);
  return state;
}

async function getModelSnapshot(
  ctx: CommandContext,
  tripName: string
): Promise<TripModel | null> {
  if (ctx.modelSnapshotsByTrip.has(tripName)) {
    return ctx.modelSnapshotsByTrip.get(tripName) ?? null;
  }
  const model = await ctx.tripDocService.getExistingModel(tripName);
  ctx.modelSnapshotsByTrip.set(tripName, model ?? null);
  return model ?? null;
}

function recordTimelineEntry(
  state: TimelineState,
  command: ParsedCommand
): { entryIndex: number; lineNumber: number } {
  const lastLineNumber = state.entries[state.entries.length - 1]?.lineNumber ?? 0;
  const lineNumber = lastLineNumber + 1;
  const entry: JournalEntry = {
    lineNumber,
    command
  };
  state.entries.push(entry);
  return { entryIndex: state.entries.length - 1, lineNumber };
}

function collectTimelineCommands(state: TimelineState, start: number, end: number): ParsedCommand[] {
  if (start >= end) {
    return [];
  }
  const commands: ParsedCommand[] = [];
  for (let position = start; position < end && position < state.orderedIndexes.length; position += 1) {
    const entryIndex = state.orderedIndexes[position];
    const entry = state.entries[entryIndex];
    if (entry) {
      commands.push(entry.command);
    }
  }
  return commands;
}

function formatUndoRedoMessage(action: "undo" | "redo", commands: ParsedCommand[]): string {
  const prefix = action === "undo" ? "Undid" : "Redid";
  if (commands.length === 0) {
    return `${prefix} 0 commands.`;
  }
  const serialized = commands.map((command) => formatCanonicalCommand(command)).join("; ");
  const detail = serialized ? `: ${serialized}` : ".";
  return `${prefix} ${commands.length} command${commands.length === 1 ? "" : "s"}${detail}`;
}

// --- Non-journalable command handlers ---

type NonJournalableHandler = (parsed: ParsedCommand, ctx: CommandContext) => CommandResponse | Promise<CommandResponse>;

function createNonJournalableHandlers(ctx: CommandContext): Record<string, NonJournalableHandler> {
  return {
    help: (parsed) => cmdHelp(parsed),
    trip: (parsed) => cmdTrip(parsed, ctx.tripDocService),
    model: (parsed) => cmdModel(parsed),
    websearch: (parsed) => cmdWebsearch(parsed),
    userpref: (parsed) => cmdUserpref(parsed),
    refreshcountries: (parsed) => cmdRefreshcountries(parsed),
    renormalize: (parsed) => cmdRenormalize(parsed, ctx.dataDir)
  };
}

// --- Journalable command handlers ---

type JournalableHandler = (
  parsed: ParsedCommand,
  ctx: CommandContext,
  timelineState: TimelineState,
  targetTrip: string
) => Promise<{ parsed: ParsedCommand; context?: CanonicalCommandContext; skipJournal?: boolean }>;

async function handleUndo(
  parsed: ParsedCommand,
  ctx: CommandContext,
  timelineState: TimelineState,
  _targetTrip: string
): Promise<{ parsed: ParsedCommand; context?: CanonicalCommandContext; skipJournal?: boolean }> {
  if (parsed.type !== "undo") throw new Error("Expected undo command");
  
  const prevHead = timelineState.head;
  const nextHead = Math.max(0, prevHead - parsed.count);
  if (nextHead === prevHead) {
    ctx.infoMessages.push("Nothing to undo.");
    return { parsed, skipJournal: true };
  }
  const undoneCommands = collectTimelineCommands(timelineState, nextHead, prevHead);
  if (undoneCommands.length) {
    ctx.infoMessages.push(formatUndoRedoMessage("undo", undoneCommands));
  }
  timelineState.head = nextHead;
  recordTimelineEntry(timelineState, parsed);
  return { parsed };
}

async function handleRedo(
  parsed: ParsedCommand,
  ctx: CommandContext,
  timelineState: TimelineState,
  _targetTrip: string
): Promise<{ parsed: ParsedCommand; context?: CanonicalCommandContext; skipJournal?: boolean }> {
  if (parsed.type !== "redo") throw new Error("Expected redo command");
  
  const prevHead = timelineState.head;
  const nextHead = Math.min(timelineState.total, timelineState.head + parsed.count);
  if (nextHead === prevHead) {
    ctx.infoMessages.push("Nothing to redo.");
    return { parsed, skipJournal: true };
  }
  const redoneCommands = collectTimelineCommands(timelineState, prevHead, nextHead);
  if (redoneCommands.length) {
    ctx.infoMessages.push(formatUndoRedoMessage("redo", redoneCommands));
  }
  timelineState.head = nextHead;
  recordTimelineEntry(timelineState, parsed);
  return { parsed };
}

async function handleAddCountry(
  parsed: ParsedCommand,
  _ctx: CommandContext,
  timelineState: TimelineState,
  _targetTrip: string
): Promise<{ parsed: ParsedCommand; context?: CanonicalCommandContext; skipJournal?: boolean }> {
  if (parsed.type !== "addcountry") throw new Error("Expected addcountry command");
  
  const enriched = await ensureCountryMetadata(parsed);
  updateTimelineForNewCommand(timelineState, enriched);
  return { parsed: enriched };
}

async function handleDelete(
  parsed: ParsedCommand,
  ctx: CommandContext,
  timelineState: TimelineState,
  targetTrip: string
): Promise<{ parsed: ParsedCommand; context?: CanonicalCommandContext; skipJournal?: boolean }> {
  if (parsed.type !== "delete") throw new Error("Expected delete command");
  
  const snapshot = await getModelSnapshot(ctx, targetTrip);
  const activity = snapshot?.activities.find((item) => item.uid === parsed.uid);
  let deleteContext: CanonicalCommandContext | undefined;
  if (activity) {
    deleteContext = { deletedActivity: { ...activity } };
  }
  updateTimelineForNewCommand(timelineState, parsed);
  return { parsed, context: deleteContext };
}

async function handleNewtrip(
  parsed: ParsedCommand,
  _ctx: CommandContext,
  _timelineState: TimelineState,
  _targetTrip: string
): Promise<{ parsed: ParsedCommand; context?: CanonicalCommandContext; skipJournal?: boolean }> {
  // newtrip creates a new journal file - it is NOT added to the undo/redo timeline
  // because you cannot undo creating a trip (the file already exists)
  return { parsed };
}

async function handleAdd(
  parsed: ParsedCommand,
  _ctx: CommandContext,
  timelineState: TimelineState,
  _targetTrip: string
): Promise<{ parsed: ParsedCommand; context?: CanonicalCommandContext; skipJournal?: boolean }> {
  if (parsed.type !== "add") throw new Error("Expected add command");
  updateTimelineForNewCommand(timelineState, parsed);
  return { parsed };
}

async function handleEdit(
  parsed: ParsedCommand,
  _ctx: CommandContext,
  timelineState: TimelineState,
  _targetTrip: string
): Promise<{ parsed: ParsedCommand; context?: CanonicalCommandContext; skipJournal?: boolean }> {
  if (parsed.type !== "edit") throw new Error("Expected edit command");
  updateTimelineForNewCommand(timelineState, parsed);
  return { parsed };
}

async function handleMoveday(
  parsed: ParsedCommand,
  _ctx: CommandContext,
  timelineState: TimelineState,
  _targetTrip: string
): Promise<{ parsed: ParsedCommand; context?: CanonicalCommandContext; skipJournal?: boolean }> {
  if (parsed.type !== "moveday") throw new Error("Expected moveday command");
  updateTimelineForNewCommand(timelineState, parsed);
  return { parsed };
}

async function handleInsertday(
  parsed: ParsedCommand,
  _ctx: CommandContext,
  timelineState: TimelineState,
  _targetTrip: string
): Promise<{ parsed: ParsedCommand; context?: CanonicalCommandContext; skipJournal?: boolean }> {
  if (parsed.type !== "insertday") throw new Error("Expected insertday command");
  updateTimelineForNewCommand(timelineState, parsed);
  return { parsed };
}

async function handleRemoveday(
  parsed: ParsedCommand,
  _ctx: CommandContext,
  timelineState: TimelineState,
  _targetTrip: string
): Promise<{ parsed: ParsedCommand; context?: CanonicalCommandContext; skipJournal?: boolean }> {
  if (parsed.type !== "removeday") throw new Error("Expected removeday command");
  updateTimelineForNewCommand(timelineState, parsed);
  return { parsed };
}

function updateTimelineForNewCommand(state: TimelineState, command: ParsedCommand): void {
  if (state.head < state.total) {
    state.total = state.head;
    state.orderedIndexes.splice(state.head);
  }
  const record = recordTimelineEntry(state, command);
  state.orderedIndexes.push(record.entryIndex);
  state.total = state.orderedIndexes.length;
  state.head = state.total;
}

function formatSearchResultsForConversation(searchResults: string[]): string {
  if (!searchResults.length) {
    return "";
  }
  const lines = searchResults.map((result, index) => `${index + 1}. ${result}`);
  return `[Search Results]\n${lines.join("\n")}`;
}

function getJournalableHandler(commandType: string): JournalableHandler {
  switch (commandType) {
    case "undo":
      return handleUndo;
    case "redo":
      return handleRedo;
    case "addcountry":
      return handleAddCountry;
    case "delete":
      return handleDelete;
    case "newtrip":
      return handleNewtrip;
    case "add":
      return handleAdd;
    case "edit":
      return handleEdit;
    case "moveday":
      return handleMoveday;
    case "insertday":
      return handleInsertday;
    case "removeday":
      return handleRemoveday;
    default:
      throw new Error(`Unknown journalable command type: ${commandType}`);
  }
}

// --- Main command processing ---

async function processCommand(
  normalizedLine: string,
  ctx: CommandContext,
  nonJournalableHandlers: Record<string, NonJournalableHandler>
): Promise<CommandResult> {
  // Determine target trip
  const quickParsed = parseCommand(normalizedLine);
  const targetTrip = quickParsed.type === "newtrip" ? quickParsed.tripId : ctx.currentTripName;
  if (quickParsed.type === "newtrip") {
    ctx.currentTripName = quickParsed.tripId;
  }

  // Get timeline state for this trip
  const timelineState = await getTimelineState(ctx, targetTrip);

  // Augment with uid and lineNum
  const getNextLineNumber = (): number => {
    const lastLineNumber = timelineState.entries[timelineState.entries.length - 1]?.lineNumber ?? 0;
    return lastLineNumber + 1;
  };
  const augmentedLine = augmentCommandLine(normalizedLine, generateUid, getNextLineNumber);

  // Parse the fully augmented line
  const parsed = parseCommand(augmentedLine);

  // Check for non-journalable commands
  const nonJournalableHandler = nonJournalableHandlers[parsed.type];
  if (nonJournalableHandler) {
    const response = await nonJournalableHandler(parsed, ctx);
    return { response, parsed, journaled: false };
  }

  // Handle journalable command
  const journalableHandler = getJournalableHandler(parsed.type);
  const result = await journalableHandler(parsed, ctx, timelineState, targetTrip);

  if (result.skipJournal) {
    return { parsed: result.parsed, journaled: false };
  }

  // Journal and apply the command
  const canonicalLine = formatCanonicalCommand(result.parsed, result.context);
  await ctx.journalService.appendCommand(targetTrip, result.parsed, canonicalLine);
  ctx.lastModel = await ctx.tripDocService.applyCommand(targetTrip, result.parsed);
  ctx.lastModelTripName = targetTrip;
  ctx.modelSnapshotsByTrip.set(targetTrip, ctx.lastModel);
  ctx.executed += 1;

  return { parsed: result.parsed, journaled: true };
}

export function createCommandRouteHandler(
  tripDocService: TripDocService,
  journalService: JournalService,
  conversationStore: ConversationStore,
  dataDir: string
) {
  return (req: Request, res: Response) =>
    executeCommandBatch(req, res, tripDocService, journalService, conversationStore, dataDir);
}

async function executeCommandBatch(
  req: Request,
  res: Response,
  tripDocService: TripDocService,
  journalService: JournalService,
  conversationStore: ConversationStore,
  dataDir: string
): Promise<void> {
  const tripName = req.params.tripName;
  const { text, focusSummary, markedActivities, markedDates } = req.body ?? {};
  
  // Log the client request for debugging
  await recordRequest({ tripName, text, focusSummary, markedActivities, markedDates });
  
  if (typeof text !== "string") {
    res.status(400).json({ error: "Payload must include text." });
    return;
  }

  // Parse chat pieces
  const chatPieces = parseChatPieces(text);

    // Normalize command pieces
    const normalizationOptions = {
      focus: { focusedActivityUid: focusSummary?.focusedActivityUid ?? null },
      referenceDate: new Date()
    };
    for (const piece of chatPieces) {
      if (isCommandPiece(piece)) {
        piece.piece = normalizeCommandLine(piece.piece, normalizationOptions);
      }
    }

    try {
      // Initialize shared context
      const ctx: CommandContext = {
        tripDocService,
        journalService,
        dataDir,
        currentTripName: tripName,
        timelineStateByTrip: new Map(),
        modelSnapshotsByTrip: new Map(),
        infoMessages: [],
        lastModel: null,
        lastModelTripName: null,
        executed: 0
      };

      const nonJournalableHandlers = createNonJournalableHandlers(ctx);
      const nonJournalableResponses: CommandResponse[] = [];

      // Process each piece - skip non-commands
      for (const piece of chatPieces) {
        if (!isCommandPiece(piece)) {
          continue;
        }

        const result = await processCommand(piece.piece, ctx, nonJournalableHandlers);

        // Update piece with the augmented/processed command
        piece.piece = formatCanonicalCommand(result.parsed);

        // Collect non-journalable responses
        if (result.response) {
          nonJournalableResponses.push(result.response);
        }
      }

      if (ctx.lastModel && ctx.lastModelTripName) {
        ctx.lastModel = await finalizeModel(ctx.lastModel);
        ctx.modelSnapshotsByTrip.set(ctx.lastModelTripName, ctx.lastModel);
      }

      // Read conversation history BEFORE appending user input
      // (so GPT sees history without the current input, which appears separately in the prompt)
      const conversationHistory = await conversationStore.read(tripName);

      // Append user input and result to conversation
      await conversationStore.append(tripName, `User: ${text.trim()}`);
      
      // Build response
      const responseBody: Record<string, unknown> = {
        ok: true,
        executedCommands: ctx.executed,
        model: ctx.lastModel,
        chatPieces
      };

      // Merge info messages
      const allMessages: string[] = [...ctx.infoMessages];
      for (const resp of nonJournalableResponses) {
        if (typeof resp.body.message === "string") {
          allMessages.push(resp.body.message);
        }
      }
      if (allMessages.length) {
        responseBody.message = allMessages.join(" ");
        await conversationStore.append(tripName, allMessages.join(" "));
      }

      // Merge non-journalable response data (trips, models, searchResults, etc.)
      for (const resp of nonJournalableResponses) {
        if (resp.body.trips) responseBody.trips = resp.body.trips;
        if (resp.body.models) responseBody.models = resp.body.models;
        if (resp.body.model) responseBody.model = resp.body.model;
        if (resp.body.activeModel) responseBody.activeModel = resp.body.activeModel;
        if (resp.body.searchResults) {
          responseBody.searchResults = resp.body.searchResults;
          // Append search results to conversation for GPT context
          const results = resp.body.searchResults as string[];
          const searchSummary = formatSearchResultsForConversation(results);
          if (searchSummary) {
            await conversationStore.append(tripName, searchSummary);
          }
        }
        if (resp.body.help) responseBody.help = resp.body.help;
      }

      // Enqueue chatbot task if input contains prose (non-command text)
      if (hasProse(chatPieces)) {
        const chatbotContext: ChatbotContext = {
          tripName,
          tripDocService,
          journalService,
          conversationStore,
          dataDir,
          focusSummary,
          markedActivities,
          markedDates,
          currentModel: ctx.lastModel,
          conversationHistory
        };
        
        const pendingChatbotGuid = enqueueGptTask(text.trim(), chatbotContext);
        responseBody.pendingChatbot = pendingChatbotGuid;
      }

      res.status(201).json(responseBody);
    } catch (error) {
      if (error instanceof CommandError || error instanceof JournalError) {
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      console.error("Command processing failed", error);
      res.status(500).json({ error: "Internal server error." });
    }
  }
