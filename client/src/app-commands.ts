/**
 * Command controller for trip-app.
 * 
 * Handles command submission, server communication, and chatbot responses.
 */

import type { Activity, TripModel } from "./types";
import { processUserCommand, extractSlashCommandLines } from "./commandUx";
import type { CommandProcessingResult } from "./commandUx";
import type { PanelDetailLogEntry } from "./components/panel-detail";
import { authFetch } from "./auth";
import { panelFocus } from "./focus";
import { panelMarks, panelDateMarks } from "./panelMarks";
import type { ConversationRole } from "./app-conversation";

export interface CommandCallbacks {
  appendMessage: (message: string, meta?: { pending?: boolean; role?: ConversationRole }) => string;
  updateMessage: (id: string, text: string, options?: { pending?: boolean }) => void;
  appendLogEntry: (entry: PanelDetailLogEntry) => void;
  setSending: (sending: boolean) => void;
  rememberTripModel: (model: TripModel) => void;
  requestUpdate: () => void;
  getCurrentTripId: () => string | null;
  getMarkedActivityIds: () => string[];
  getMarkedDateKeys: () => string[];
  getTripModel: () => TripModel | null;
  nextLogEntryId: () => string;
}

export interface CommandState {
  sending: boolean;
  chatbotStopRequested: boolean;
  pendingEditedUid: string | null;
  pendingNewActivityPrevUids: Set<string> | null;
}

export class AppCommands {
  private state: CommandState = {
    sending: false,
    chatbotStopRequested: false,
    pendingEditedUid: null,
    pendingNewActivityPrevUids: null
  };

  private callbacks: CommandCallbacks;

  constructor(callbacks: CommandCallbacks) {
    this.callbacks = callbacks;
  }

  // --- State getters ---

  get sending(): boolean {
    return this.state.sending;
  }

  get pendingEditedUid(): string | null {
    return this.state.pendingEditedUid;
  }

  set pendingEditedUid(value: string | null) {
    this.state.pendingEditedUid = value;
  }

  get pendingNewActivityPrevUids(): Set<string> | null {
    return this.state.pendingNewActivityPrevUids;
  }

  set pendingNewActivityPrevUids(value: Set<string> | null) {
    this.state.pendingNewActivityPrevUids = value;
  }

  // --- Command submission ---

  requestStop(): void {
    this.state.chatbotStopRequested = true;
    this.callbacks.appendMessage("Client:\nℹ Stop requested...", { role: "Client" });
  }

  async submitCommand(
    text: string,
    options?: { skipChat?: boolean; showSearchResults?: boolean; suppressEcho?: boolean }
  ): Promise<CommandProcessingResult | null> {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    this.state.pendingEditedUid = this.extractLastEditedUid(text);
    if (this.containsAddCommand(text)) {
      this.state.pendingNewActivityPrevUids = this.captureCurrentActivityUids();
    }

    const shouldShowSearchResults = options?.showSearchResults ?? true;

    // Reset stop flag when starting a new command
    this.state.chatbotStopRequested = false;

    const result = await processUserCommand({
      text,
      currentTripId: this.callbacks.getCurrentTripId() ?? "",
      focusSummary: panelFocus.describeFocus(),
      markedActivities: this.callbacks.getMarkedActivityIds(),
      markedDates: this.callbacks.getMarkedDateKeys(),
      appendMessage: (message, meta) => this.callbacks.appendMessage(message, meta),
      updateMessage: (id, newText, meta) => this.callbacks.updateMessage(id, newText, meta),
      setSending: (sending) => {
        this.state.sending = sending;
        this.callbacks.setSending(sending);
      },
      rememberTripModel: (model) => this.callbacks.rememberTripModel(model),
      updateMarks: (activities, dates) => {
        if (activities !== undefined) panelMarks.setAll(activities);
        if (dates !== undefined) panelDateMarks.setAll(dates);
      },
      shouldStop: () => this.state.chatbotStopRequested,
      echoCommands: !(options?.suppressEcho ?? false)
    });

    if (result.payload?.searchResults) {
      const queryText = result.payload.query ?? "(unknown query)";
      const snippets = result.payload.searchResults;
      const humanSummary = `Search "${queryText}" (${snippets.length})`;
      if (shouldShowSearchResults) {
        this.callbacks.appendLogEntry({
          id: this.callbacks.nextLogEntryId(),
          kind: "search",
          summary: humanSummary,
          snippets
        });
      }
    }

    return result;
  }

  // --- Chatbot health check ---

  async announceChatConnection(): Promise<void> {
    try {
      const response = await authFetch("/api/gpt/health");
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        model?: string;
        error?: string;
      };
      if (response.ok && payload?.ok) {
        const model = payload.model ?? "unknown";
        const message = payload.message ?? `Chatbot ${model} connected.`;
        this.callbacks.appendMessage(`Client:\n${message}`, { role: "Client" });
      } else {
        const detail = payload?.error ?? response.statusText ?? "Failed";
        this.callbacks.appendMessage(`Client:\nChatbot connection failed: ${detail}`, { role: "Client" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.callbacks.appendMessage(`Client:\nChatbot connection failed: ${message}`, { role: "Client" });
    }
  }

  // --- Helper methods ---

  private containsAddCommand(text: string): boolean {
    const commands = extractSlashCommandLines(text);
    return commands.some((line) => line.trimStart().toLowerCase().startsWith("/add"));
  }

  private captureCurrentActivityUids(): Set<string> {
    const set = new Set<string>();
    const model = this.callbacks.getTripModel();
    for (const activity of model?.activities ?? []) {
      if (activity.uid) {
        set.add(activity.uid);
      }
    }
    return set;
  }

  extractLastEditedUid(text: string): string | null {
    let lastUid: string | null = null;
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const parsedUid = this.parseUidFromEditLine(line);
      if (parsedUid) {
        lastUid = parsedUid;
      }
    }
    return lastUid;
  }

  private parseUidFromEditLine(line: string): string | null {
    if (!line.startsWith("/edit")) {
      return null;
    }
    const remainder = line.slice("/edit".length).trim();
    if (!remainder) {
      return null;
    }
    const firstToken = remainder.split(/\s+/)[0];
    if (firstToken && !firstToken.includes("=")) {
      return firstToken;
    }
    const uidMatch = remainder.match(/uid=("(?:\\.|[^"\\])*"|[^\s]+)/);
    if (!uidMatch) {
      return null;
    }
    const rawValue = uidMatch[1];
    if (rawValue.startsWith("\"")) {
      try {
        return JSON.parse(rawValue);
      } catch {
        return rawValue.slice(1, -1);
      }
    }
    return rawValue;
  }
}
