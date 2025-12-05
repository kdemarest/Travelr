import type { Request, Response } from "express";
import { CommandWithArgs, parseCommand } from "./command.js";
import { CommandError, JournalError } from "./errors.js";
import type { TripCache } from "./trip-cache.js";
import { rebuildModel } from "./journal-state.js";
import { generateUid } from "./uid.js";
import type { TripModel } from "./types.js";
import { finalizeModel } from "./finalize-model.js";
import { parseChatPieces, isCommandPiece, hasProse } from "./chat-pieces.js";
import { normalizeCommandLine, normalizeDateFields, normalizeTimeFields } from "./normalize.js";
import { getCommandMetadata, type EnrichContext } from "./command-registry.js";
import { enqueueGptTask, type ChatbotContext } from "./chatbot.js";
import { recordRequest } from "./gpt.js";
import type { AuthenticatedRequest } from "./index.js";
import type { CommandContext } from "./command-context.js";
import { setLastTripId } from "./auth.js";
import { populateTripList } from "./cache-population.js";

// Result from processing a single command
interface CommandResult {
  // Data to merge into the final response
  data?: Record<string, unknown>;
  // Updated command (e.g., after addcountry enrichment)
  command: CommandWithArgs;
  // Whether this command was journaled
  journaled: boolean;
  // Optional message to display to user (e.g., from undo/redo)
  message?: string;
  // Stop processing remaining commands in the batch
  stopProcessingCommands?: boolean;
  // Switch to a different trip (deferred until after current command completes)
  switchTrip?: { tripId: string; create?: boolean };
}

function formatSearchResultsForConversation(searchResults: string[]): string {
  if (!searchResults.length) {
    return "";
  }
  const lines = searchResults.map((result, index) => `${index + 1}. ${result}`);
  return `[Search Results]\n${lines.join("\n")}`;
}

/**
 * Flush pending data to the current trip's conversation before switching trips.
 * This ensures search results and other collected data are logged to the correct trip.
 * 
 * WARNING: This clears collectedData after flushing. The response to the client should
 * only contain data from the FINAL trip - each trip's conversation is its own
 * authoritative log. If you want to see what happened on a prior trip, switch to it.
 */
function flushCollectedDataToConversation(
  collectedData: Record<string, unknown>[],
  conversation: { append: (text: string) => void }
): void {
  for (const data of collectedData) {
    if (data.searchResults) {
      const results = data.searchResults as string[];
      const searchSummary = formatSearchResultsForConversation(results);
      if (searchSummary) {
        conversation.append(searchSummary);
      }
    }
  }
  // Clear the array after flushing
  collectedData.length = 0;
}

interface CommandLoopState {
  ctx: CommandContext;
  currentModel: TripModel;
  collectedData: Record<string, unknown>[];
  infoMessages: string[];
  tripSwitched: boolean;
}

/**
 * Handle /trip or /newtrip mid-batch: flush current trip data, switch context to the new trip.
 */
async function switchToTripDuringCommandProcessing(
  tripId: string,
  create: boolean,
  tripCache: TripCache,
  state: CommandLoopState
): Promise<void> {
  // Flush collected data to current trip before switching
  flushCollectedDataToConversation(state.collectedData, state.ctx.trip.conversation);
  
  // Update the user's last trip
  setLastTripId(state.ctx.user.userId, tripId);
  
  // Load (or create) the new trip and update context
  state.ctx.trip = await tripCache.getTrip(tripId);
  state.currentModel = rebuildModel(state.ctx.trip);
  state.tripSwitched = true;
  
  // Update client data cache with trip list
  await populateTripList(state.ctx.user);
  
  // Message to user - this goes to the NEW trip's conversation
  const verb = create ? "Created" : "Now editing";
  const switchMessage = `${verb} ${tripId}`;
  state.infoMessages.push(switchMessage);
  state.ctx.trip.conversation.append(switchMessage);
}

// --- Main command processing ---

async function processCommand(
  command: CommandWithArgs,
  ctx: CommandContext
): Promise<CommandResult> {
  // Look up command metadata from registry
  const parsed = parseCommand(command);
  const metadata = getCommandMetadata(parsed.commandId);
  if (!metadata?.handler) {
    throw new CommandError(`Unknown command: /${parsed.commandId}`);
  }

  // Check if this is an admin-only command
  if (metadata.adminOnly && !ctx.user.isAdmin) {
    throw new CommandError(`The '${parsed.commandId}' command requires admin access.`);
  }

  // Execute the handler
  const result = await metadata.handler(command, ctx);

  // Non-journalable command (has data but no journal write)
  if (result.data || result.stopProcessingCommands || result.switchTrip) {
    return { 
      data: result.data, 
      command, 
      journaled: false, 
      message: result.message,
      stopProcessingCommands: result.stopProcessingCommands,
      switchTrip: result.switchTrip
    };
  }

  // Journalable command - skip if requested
  if (result.skipJournal) {
    return { command, journaled: false, message: result.message };
  }

  // Journal and apply the command
  const canonicalLine = command.toString();
  await ctx.trip.journal.appendCommand(command, canonicalLine);

  return { command, journaled: true, message: result.message };
}

export function createCommandRouteHandler(
  tripCache: TripCache
) {
  return (req: Request, res: Response) =>
    executeCommandBatch(req, res, tripCache);
}

async function executeCommandBatch(
  req: Request,
  res: Response,
  tripCache: TripCache
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

  try {
      // User is already authenticated by middleware
      const user = (req as AuthenticatedRequest).user;
      
      console.log("[api-command] User:", { userId: user.userId, isAdmin: user.isAdmin });

      // Get the trip for this batch
      const trip = await tripCache.getTrip(tripName);

      // Initialize shared state for command loop
      const state: CommandLoopState = {
        ctx: { trip, user },
        currentModel: rebuildModel(trip),
        collectedData: [],
        infoMessages: [],
        tripSwitched: false
      };

      let journaledCount = 0;

      // Process each piece - skip non-commands
      for (const piece of chatPieces) {
        if (!isCommandPiece(piece)) {
          continue;
        }

		const enrichContext: EnrichContext = {
			focusedActivityUid: focusSummary?.focusedActivityUid,
        	getNextLineNumber: () => state.ctx.trip.journal.nextLineNumber,
        	lookupActivity: (uid: string) => state.currentModel.activities.find(a => a.uid === uid),
			generateUid,
		};

        let commandObj = normalizeCommandLine(piece.piece);

		normalizeDateFields(commandObj);
  		normalizeTimeFields(commandObj);

        // Run command-specific enricher if registered
        const metadata = getCommandMetadata(commandObj.commandId);
        if (metadata?.enricher) {
          await metadata.enricher(commandObj, enrichContext);
        }

        // 4. Process the fully prepared command
        const result = await processCommand(commandObj, state.ctx);

        // 5. Update piece with canonical form
        piece.piece = commandObj.toString();

        if (result.journaled) {
          journaledCount += 1;
          // Rebuild model so subsequent commands see updated state
          state.currentModel = rebuildModel(state.ctx.trip);
        }

        // Collect data from non-journalable commands
        if (result.data) {
          state.collectedData.push(result.data);
        }

        // Collect info messages and append to current trip's conversation immediately
        if (result.message) {
          state.infoMessages.push(result.message);
          state.ctx.trip.conversation.append(result.message);
        }

        // Handle trip switching (/trip or /newtrip)
        if (result.switchTrip) {
          await switchToTripDuringCommandProcessing(
            result.switchTrip.tripId,
            result.switchTrip.create ?? false,
            tripCache,
            state
          );
          continue;
        }

        // Stop processing if requested (e.g., failed /trip switch)
        if (result.stopProcessingCommands) {
          break;
        }
      }

      // Finalize model for response
      // Return model if anything was journaled, or if we switched trips
      let model: TripModel | null = null;
      if (journaledCount > 0 || state.tripSwitched) {
        model = finalizeModel(state.currentModel);
      }

      // Read conversation history BEFORE appending user input
      // (so GPT sees history without the current input, which appears separately in the prompt)
      const conversationHistory = state.ctx.trip.conversation.read();

      // Append user input and result to conversation
      state.ctx.trip.conversation.append(`User: ${text.trim()}`);
      
      // Build response
      const responseBody: Record<string, unknown> = {
        ok: true,
        executedCommands: journaledCount,
        model,
        chatPieces
      };

      // Merge info messages for response (already appended to conversations during processing)
      if (state.infoMessages.length) {
        responseBody.message = state.infoMessages.join(" ");
      }

      // Merge collected data into response and flush to conversation
      for (const data of state.collectedData) {
        if (data.model) responseBody.model = data.model;
        if (data.searchResults) responseBody.searchResults = data.searchResults;
      }
      flushCollectedDataToConversation(state.collectedData, state.ctx.trip.conversation);

      // Enqueue chatbot task if input contains prose (non-command text)
      if (hasProse(chatPieces)) {
        const chatbotContext: ChatbotContext = {
          tripName,
          tripCache,
          userPreferences: { ...user.prefsFile.data },
          focusSummary,
          markedActivities,
          markedDates,
          currentModel: model,
          conversationHistory
        };
        
        const pendingChatbotGuid = enqueueGptTask(text.trim(), chatbotContext);
        responseBody.pendingChatbot = pendingChatbotGuid;
      }

      // Include client data cache if dirty
      if (user.clientDataCache.isDirty()) {
        responseBody.clientDataCache = user.clientDataCache.getData();
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
