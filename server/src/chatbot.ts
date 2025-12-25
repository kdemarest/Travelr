/**
 * Chatbot - handles GPT interactions, command execution from GPT responses,
 * and chaining for multi-turn conversations (e.g., after websearch)
 */

import type { TripCache } from "./trip-cache.js";
import type { Conversation } from "./conversation.js";
import type { TripModel } from "./types.js";
import type { UserPreferences } from "./user-preferences.js";
import { getActiveModel, sendChatCompletion } from "./gpt.js";
import { finalizeModel } from "./finalize-model.js";
import { gptQueue, type GptQueueResult } from "./gpt-queue.js";
import { parseChatPieces, isCommandPiece } from "./chat-pieces.js";
import { CommandWithArgs, parseCommand } from "./command.js";
import { executeMarkCommand } from "./cmd-mark.js";
import { normalizeCommandLine } from "./normalize.js";
import { rebuildModel } from "./journal-state.js";
import { generateUid } from "./uid.js";
import { isJournalableCommand, isChatbotExecutable, requiresChaining } from "./command-meta.js";

// Context needed for GPT calls and command execution
export interface ChatbotContext {
  tripName: string;
  tripCache: TripCache;
  userPreferences: UserPreferences;
  focusSummary?: { focusedDate?: string | null; focusedActivityUid?: string | null };
  markedActivities?: unknown;
  markedDates?: unknown;
  currentModel: TripModel | null;
  // Conversation history captured BEFORE the current user input was appended
  conversationHistory: string;
}

/**
 * Enqueue a GPT task for async processing
 * Returns a GUID that the client can poll
 */
export function enqueueGptTask(userInput: string, ctx: ChatbotContext): string {
  return gptQueue.enqueue(() => executeGptTask(userInput, ctx));
}

/**
 * Check if a command type is a mark command
 */
function isMarkCommand(commandType: string): boolean {
  return commandType === "mark";
}

/**
 * Execute a GPT task - calls GPT, executes any commands it emits,
 * and chains follow-up calls if needed (e.g., after websearch)
 */
async function executeGptTask(
  userInput: string,
  ctx: ChatbotContext
): Promise<GptQueueResult> {
  try {
    const gptResult = await callGptWithContext(userInput, ctx);
    
    // Check if GPT emitted any commands
    const pieces = parseChatPieces(gptResult.text);
    const commandPieces = pieces.filter(isCommandPiece);
    
    if (commandPieces.length === 0) {
      // No commands - just return the response
      return {
        text: gptResult.text,
        model: gptResult.model
      };
    }
    
    // Execute GPT's commands
    let executedCount = 0;
    let needsChaining = false;
    let updatedModel = ctx.currentModel;
    let markedActivities = normalizeMarkedArray(ctx.markedActivities);
    let markedDates = normalizeMarkedArray(ctx.markedDates);
    // Only non-null if chatbot issued /mark for that type
    let chatbotActivityMarks: string[] | null = null;
    let chatbotDateMarks: string[] | null = null;
    
    for (const piece of commandPieces) {
      const line = piece.piece;
      const parsed = parseCommand(new CommandWithArgs(line));
      if (!parsed || !isChatbotExecutable(parsed.commandId)) continue;
      
      if (requiresChaining(parsed.commandId)) {
        needsChaining = true;
      }
      
      try {
        if (isJournalableCommand(parsed.commandId)) {
          const result = await executeGptCommand(line, ctx);
          if (result.model) {
            updatedModel = result.model;
          }
        } else if (isMarkCommand(parsed.commandId) && parsed.commandId === "mark") {
          console.log("Executing mark command:", line);
          const markResult = executeMarkCommand(parsed, markedActivities, markedDates);
          console.log("Mark result:", markResult);
          markedActivities = markResult.markedActivities;
          markedDates = markResult.markedDates;
          if (parsed.markType === "activities") {
            chatbotActivityMarks = markedActivities;
          } else {
            chatbotDateMarks = markedDates;
          }
        } else {
          await executeWebsearchFromGpt(line, ctx);
        }
        executedCount++;
      } catch (err) {
        console.error(`GPT ${parsed.commandId} command failed`, err);
      }
    }
    
    // If any command requires chaining, enqueue a follow-up GPT call
    if (needsChaining) {
      // For chained calls, read fresh history (includes GPT response + search results)
      const freshTrip = await ctx.tripCache.getTrip(ctx.tripName);
      const freshHistory = freshTrip.conversation.read();
      const nextCtx: ChatbotContext = {
        ...ctx,
        currentModel: updatedModel,
        markedActivities,
        markedDates,
        conversationHistory: freshHistory
      };
      const nextGuid = gptQueue.enqueue(() => 
        executeGptTask("(continue after websearch)", nextCtx)
      );
      
      const result: GptQueueResult = {
        text: gptResult.text,
        model: gptResult.model,
        executedCommands: executedCount,
        updatedModel,
        nextGuid
      };
      // Only include marks for types the chatbot actually marked
      if (chatbotActivityMarks !== null) {
        result.markedActivities = chatbotActivityMarks;
      }
      if (chatbotDateMarks !== null) {
        result.markedDates = chatbotDateMarks;
      }
      return result;
    }
    
    const result: GptQueueResult = {
      text: gptResult.text,
      model: gptResult.model,
      executedCommands: executedCount,
      updatedModel
    };
    // Only include marks for types the chatbot actually marked
    if (chatbotActivityMarks !== null) {
      result.markedActivities = chatbotActivityMarks;
    }
    if (chatbotDateMarks !== null) {
      result.markedDates = chatbotDateMarks;
    }
    return result;
  } catch (error) {
    console.error("GPT task failed", error);
    return {
      text: "",
      model: "",
      error: error instanceof Error ? error.message : "GPT unavailable"
    };
  }
}

/**
 * Call GPT with full context (model, conversation history, preferences, etc.)
 */
async function callGptWithContext(
  userInput: string,
  ctx: ChatbotContext
): Promise<{ text: string; model: string }> {
  const { tripName, tripCache, userPreferences, focusSummary, markedActivities, markedDates, currentModel, conversationHistory } = ctx;

  // Use provided model or fetch fresh, always finalize for prompt
  let model: TripModel;
  if (currentModel) {
    model = finalizeModel(currentModel);
  } else {
    if (!(await tripCache.tripExists(tripName))) {
      throw new Error(`Trip ${tripName} does not exist.`);
    }
    const existingTrip = await tripCache.getTrip(tripName);
    const existing = rebuildModel(existingTrip);
    model = finalizeModel(existing);
  }

  const normalizedMarks = normalizeMarkedArray(markedActivities);
  const normalizedDates = normalizeMarkedArray(markedDates);
  const mergedFocusSummary = JSON.stringify({
    focusedDate: focusSummary?.focusedDate ?? null,
    focusedActivityUid: focusSummary?.focusedActivityUid ?? null,
    markedActivities: normalizedMarks,
    markedDates: normalizedDates
  }, null, 2);

  const result = await sendChatCompletion(userInput, {
    temperature: 0.3,
    templateContext: {
      tripModel: model,
      userInput,
      conversationHistory,
      focusSummary: mergedFocusSummary,
      userPreferences,
      markedActivities: normalizedMarks,
      markedDates: normalizedDates
    }
  });

  // Append GPT response to conversation
  const modelName = getActiveModel();
  const sanitizedText = sanitizeAssistantText(result.text);
  const tripForConv = await tripCache.getTrip(tripName);
  // Use Role:\n format for conversation entries
  tripForConv.conversation.append(`Chatbot:\n${sanitizedText}`);

  return { text: sanitizedText, model: modelName };
}

let stripHtml = false;
function sanitizeAssistantText(text: string): string {
  if (!text) {
    return "";
  }
  if(!stripHtml)
	return text;
  
  // Strip all HTML tags to ensure slash commands remain plain text
  let cleaned = text.replace(/<[^>]+>/g, "");

  // Decode a few common entities so "/add" survives if it was escaped
  cleaned = cleaned
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

  return cleaned.trim();
}

function normalizeMarkedArray(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const unique = new Set<string>();
  for (const value of input) {
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length) {
        unique.add(trimmed);
      }
    }
  }
  return Array.from(unique);
}

/**
 * Execute a websearch command from GPT
 */
async function executeWebsearchFromGpt(
  commandLine: string,
  ctx: ChatbotContext
): Promise<void> {
  // Parse the command properly
  const parsed = parseCommand(new CommandWithArgs(commandLine));
  if (!parsed || parsed.commandId !== "websearch") {
    return;
  }
  
  // Use the search handler directly
  const { handleGoogleSearch } = await import("./search.js");
  const query = (parsed as { query: string }).query;
  const { snippets } = await handleGoogleSearch(query);
  
  // Append results to conversation
  if (snippets.length > 0) {
    const summary = formatSearchResultsForConversation(snippets);
    if (summary) {
      const searchTrip = await ctx.tripCache.getTrip(ctx.tripName);
      searchTrip.conversation.append(summary);
    }
  }
}

/**
 * Execute a journalable command from GPT (add/edit/delete/addcountry)
 */
async function executeGptCommand(
  commandLine: string,
  ctx: ChatbotContext
): Promise<{ model?: TripModel }> {
  const parsed = parseCommand(new CommandWithArgs(commandLine));
  if (!parsed) {
    return {};
  }
  
  // Normalize the command (returns a Command object)
  const commandObj = normalizeCommandLine(commandLine);
  
  // Write to journal
  const cmdTrip = await ctx.tripCache.getTrip(ctx.tripName);
  await cmdTrip.journal.appendCommand(commandObj, commandObj.toString());
  
  // Rebuild model with full finalization
  const model = rebuildModel(cmdTrip);
  const finalizedModel = finalizeModel(model);
  
  return { model: finalizedModel };
}

/**
 * Format search results for conversation history
 */
function formatSearchResultsForConversation(results: string[]): string {
  if (!results.length) {
    return "";
  }
  const truncated = results.slice(0, 5);
  const lines = truncated.map((r, i) => `${i + 1}. ${r}`);
  return `Search:\n${lines.join("\n")}`;
}
