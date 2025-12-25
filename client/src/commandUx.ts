import type { TripModel } from "./types";
import { normalizeUserDate } from "./ux-date";
import { normalizeUserTime } from "./ux-time";
import { parseCanonicalCommand } from "./command-parse";
import { parseChatPieces, isCommandPiece, reconstructText, type ChatPiece } from "./chat-pieces";
import { authFetch } from "./auth";
import { clientDataCache, type ClientDataCacheData } from "./client-data-cache";
import type { ConversationRole } from "./app-conversation";

/**
 * Format a client-generated message for conversation display.
 * Uses "Client:\n<content>" format to match the role system.
 */
function clientMessage(content: string): string {
  return `Client:\n${content}`;
}

export interface CommandProcessingResult {
  ok: boolean;
  payload?: CommandResponse;
}

interface CommandResponse {
  executedCommands?: number;
  message?: string;
  error?: string;
  model?: TripModel;
  query?: string;
  searchResults?: string[];
  chatPieces?: Array<{ kind: string; piece: string }>;
  // GUID for polling chatbot response
  pendingChatbot?: string;
  // Server-side cache data
  clientDataCache?: ClientDataCacheData;
}

interface ChatbotPollResponse {
  ok: boolean;
  text?: string;
  model?: string;
  executedCommands?: number;
  updatedModel?: TripModel;
  chatbotActivityMarks?: string[];
  chatbotDateMarks?: string[];
  pendingChatbot?: string;
  error?: string;
}

export interface CommandUxOptions {
  text: string;
  currentTripId: string;
  focusSummary: { focusedDate: string | null; focusedActivityUid: string | null };
  markedActivities?: string[];
  markedDates?: string[];
  appendMessage: (message: string, options?: { role?: ConversationRole; pending?: boolean }) => string;
  updateMessage: (id: string, text: string, options?: { pending?: boolean }) => void;
  setSending: (sending: boolean) => void;
  rememberTripModel: (model: TripModel) => void;
  // Called when chatbot updates marks (only arrays that changed are provided)
  updateMarks?: (activities: string[] | undefined, dates: string[] | undefined) => void;
  // Check if user requested stop
  shouldStop?: () => boolean;
  echoCommands?: boolean;
}

export async function processUserCommand(options: CommandUxOptions): Promise<CommandProcessingResult> {
  const preparedText = prepareOutgoingText(options.text);
  const pieces = parseChatPieces(preparedText);
  const hasJournalableCommands = pieces.some((p) => isJournalableCommand(p));
  
  // Echo user input - pending if it has journalable commands that need server confirmation
  let pendingMessageId: string | null = null;
  if (options.echoCommands ?? true) {
    pendingMessageId = options.appendMessage(preparedText, { 
      role: "User", 
      pending: hasJournalableCommands 
    });
  }
  
  options.setSending(true);

  try {
    const textForServer = reconstructText(pieces);
    const response = await authFetch(`/api/trip/${options.currentTripId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        text: textForServer,
        focusSummary: options.focusSummary,
        markedActivities: options.markedActivities,
        markedDates: options.markedDates
      })
    });
    const payload = (await response.json().catch(() => ({}))) as CommandResponse;

    if (!response.ok) {
      if (pendingMessageId) {
        options.updateMessage(pendingMessageId, preparedText, { pending: false });
      }
      options.appendMessage(clientMessage(`✗ ${payload.error ?? response.statusText}`), { role: "Client" });
      return { ok: false, payload };
    }

    // Update the pending message with authoritative text from server
    if (pendingMessageId) {
      const finalText = payload.chatPieces ?
	  	reconstructText(payload.chatPieces) :
		preparedText;
      options.updateMessage(pendingMessageId, finalText, { pending: false });
    }

    // Update client data cache if server sent new data
    if (payload.clientDataCache) {
      clientDataCache.update(payload.clientDataCache);
    }

    if (payload.message && !payload.searchResults) {
      options.appendMessage(clientMessage(`ℹ ${payload.message}`), { role: "Client" });
    }

    if (payload.model) {
      options.rememberTripModel(payload.model);
    }

    const totalExecuted = payload.executedCommands ?? 0;
    if (totalExecuted > 0) {
      options.appendMessage(clientMessage(`✓ Executed ${totalExecuted} command(s)`), { role: "Client" });
    }

    // Poll for chatbot responses if a task was queued
    if (payload.pendingChatbot) {
      await pollChatbotResponses(payload.pendingChatbot, options);
    }

    return { ok: true, payload };
  } catch (error) {
    if (pendingMessageId) {
      options.updateMessage(pendingMessageId, preparedText, { pending: false });
    }
    const message = error instanceof Error ? error.message : String(error);
    options.appendMessage(clientMessage(`Network error: ${message}`), { role: "Client" });
    return { ok: false };
  } finally {
    options.setSending(false);
  }
}

/**
 * Poll the server for chatbot responses until complete or stopped
 */
async function pollChatbotResponses(
  guid: string,
  options: Pick<CommandUxOptions, 'appendMessage' | 'rememberTripModel' | 'updateMarks' | 'shouldStop'>
): Promise<void> {
  let currentGuid: string | null = guid;
  
  while (currentGuid) {
    // Check if user requested stop
    if (options.shouldStop?.()) {
      options.appendMessage(clientMessage("ℹ Chatbot response cancelled."), { role: "Client" });
      return;
    }
    
    try {
      const response = await authFetch(`/api/chain/${currentGuid}`);
      const result = (await response.json().catch(() => ({}))) as ChatbotPollResponse;
      
      if (!response.ok) {
        options.appendMessage(clientMessage(`Chatbot error: ${result.error ?? response.statusText}`), { role: "Client" });
        return;
      }
      
      if (result.error) {
        options.appendMessage(clientMessage(`Chatbot error: ${result.error}`), { role: "Client" });
        return;
      }
      
      // Display GPT response
      if (result.text) {
        options.appendMessage(`Chatbot:\n${result.text}`, { role: "Chatbot" });
      }
      
      // Update model if GPT executed commands
      if (result.updatedModel) {
        options.rememberTripModel(result.updatedModel);
      }
      
      // Update marks if chatbot executed /mark commands
      if (result.chatbotActivityMarks !== undefined || result.chatbotDateMarks !== undefined) {
        options.updateMarks?.(result.chatbotActivityMarks, result.chatbotDateMarks);
      }
      
      if (result.executedCommands && result.executedCommands > 0) {
        options.appendMessage(clientMessage(`✓ Chatbot executed ${result.executedCommands} command(s)`), { role: "Client" });
      }
      
      // Continue polling if there's a follow-up
      currentGuid = result.pendingChatbot ?? null;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      options.appendMessage(clientMessage(`Network error polling chatbot: ${message}`), { role: "Client" });
      return;
    }
  }
}
export function prepareOutgoingText(input: string, referenceDate = new Date()): string {
  return input
    .split(/\r?\n/)
    .map((line) => normalizeDateFields(line, referenceDate))
    .map((line) => normalizeTimeFields(line))
    .join("\n");
}

const DATE_ARG_PATTERN = /\bdate=("(?:\\.|[^"\\])*"|[^\s]+)/gi;
const TIME_ARG_PATTERN = /\btime=("(?:\\.|[^"\\])*"|[^\s]+)/gi;

function normalizeDateFields(line: string, referenceDate: Date): string {
  if (!line.includes("date=")) {
    return line;
  }

  return line.replace(DATE_ARG_PATTERN, (match, rawValue) => {
    const decoded = decodeArgumentValue(rawValue);
    if (!decoded) {
      return match;
    }
    const normalized = normalizeUserDate(decoded, referenceDate);
    if (!normalized) {
      return match;
    }
    return `date="${normalized}"`;
  });
}

function normalizeTimeFields(line: string): string {
  if (!line.includes("time=")) {
    return line;
  }

  return line.replace(TIME_ARG_PATTERN, (match, rawValue) => {
    const decoded = decodeArgumentValue(rawValue);
    if (!decoded) {
      return match;
    }
    const normalized = normalizeUserTime(decoded);
    if (!normalized) {
      return match;
    }
    return `time="${normalized}"`;
  });
}

function decodeArgumentValue(value: string): string | null {
  if (!value) {
    return null;
  }

  if (value.startsWith("\"")) {
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  }

  return value;
}

export function extractSlashCommandLines(text: string): string[] {
  return parseChatPieces(text)
    .filter(isCommandPiece)
    .map((p) => p.piece);
}

const JOURNALABLE_COMMANDS = new Set([
  "/add",
  "/edit",
  "/delete",
  "/moveday",
  "/insertday",
  "/removeday",
  "/undo",
  "/redo",
  "/addcountry",
  "/setalarm",
  "/deletealarm",
  "/enablealarm",
  "/disablealarm"
]);

function isJournalableCommand(piece: ChatPiece): boolean {
  if (!isCommandPiece(piece)) {
    return false;
  }
  const parsed = parseCanonicalCommand(piece.piece);
  if (!parsed) {
    return false;
  }
  return JOURNALABLE_COMMANDS.has(parsed.keyword.toLowerCase());
}
