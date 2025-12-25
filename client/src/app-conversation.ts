/**
 * Conversation controller for trip-app.
 * 
 * Manages chat messages state and conversation history loading.
 */

import type { PanelDetailLogEntry } from "./components/panel-detail";
import { authFetch } from "./auth";

/**
 * Conversation Role System
 * 
 * Every conversation line is prefixed with exactly one of these roles on its own line.
 * The role line format is: "Role:" 
 * Content follows on subsequent lines until the next role marker.
 */
export type ConversationRole = "User" | "Server" | "Chatbot" | "Search" | "Client";

interface RoleConfig {
  isUser: boolean;
}

const ROLE_REGISTRY: Record<ConversationRole, RoleConfig> = {
  User: { isUser: true },
  Server: { isUser: false },
  Chatbot: { isUser: false },
  Search: { isUser: false },
  Client: { isUser: false }
};

const ROLE_PATTERN = /^(User|Server|Chatbot|Search|Client):$/i;

function parseRoleLine(line: string): ConversationRole | null {
  const match = line.trim().match(ROLE_PATTERN);
  if (!match) return null;
  // Normalize to proper case
  const role = match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
  return role as ConversationRole;
}

export interface ConversationCallbacks {
  requestUpdate: () => void;
}

export class AppConversation {
  private _messages: PanelDetailLogEntry[] = [];
  private logEntryCounter = 0;
  private conversationHistoryRequestId = 0;
  private callbacks: ConversationCallbacks;

  constructor(callbacks: ConversationCallbacks) {
    this.callbacks = callbacks;
  }

  // --- Getters ---

  get messages(): PanelDetailLogEntry[] {
    return this._messages;
  }

  // --- Log entry management ---

  nextLogEntryId(): string {
    this.logEntryCounter += 1;
    return `log-${this.logEntryCounter}`;
  }

  appendMessage(message: string, meta?: { pending?: boolean; role?: ConversationRole }): string {
    const id = this.nextLogEntryId();
    const role = meta?.role ?? this.detectRoleFromMessage(message) ?? "Server";
    this._messages = [
      ...this._messages,
      { id, kind: "text", text: message, role, isUser: role === "User", pending: meta?.pending }
    ];
    this.callbacks.requestUpdate();
    return id;
  }

  updateMessage(id: string, text: string, options?: { pending?: boolean }): void {
    const idx = this._messages.findIndex((entry) => entry.id === id);
    if (idx === -1) {
      return;
    }
    const existing = this._messages[idx];
    // Only text entries can be updated
    if (existing.kind !== "text") {
      return;
    }
    const updated: PanelDetailLogEntry = { 
      ...existing, 
      text,
      pending: options?.pending ?? existing.pending
    };
    this._messages = [...this._messages.slice(0, idx), updated, ...this._messages.slice(idx + 1)];
    this.callbacks.requestUpdate();
  }

  appendLogEntry(entry: PanelDetailLogEntry): void {
    this._messages = [...this._messages, entry];
    this.callbacks.requestUpdate();
  }

  resetConversationLog(): void {
    this._messages = [];
    this.logEntryCounter = 0;
    this.callbacks.requestUpdate();
  }

  // --- Conversation history loading ---

  async loadConversationHistory(tripId: string | null): Promise<void> {
    const requestId = ++this.conversationHistoryRequestId;
    if (!tripId) {
      this.resetConversationLog();
      return;
    }

    try {
      const response = await authFetch(`/api/trip/${encodeURIComponent(tripId)}/conversation`);
      if (requestId !== this.conversationHistoryRequestId) {
        return;
      }
      if (!response.ok) {
        this.resetConversationLog();
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { history?: string };
      if (requestId !== this.conversationHistoryRequestId) {
        return;
      }
      const historyText = typeof payload.history === "string" ? payload.history : "";
      this.applyConversationHistory(historyText);
    } catch (error) {
      if (requestId !== this.conversationHistoryRequestId) {
        return;
      }
      console.error("Failed to load conversation history", error);
      this.resetConversationLog();
    }
  }

  private applyConversationHistory(history: string): void {
    const normalized = history.replace(/\r\n/g, "\n").trim();
    if (!normalized) {
      this.resetConversationLog();
      return;
    }
    const restored = this.parseConversationHistoryForDisplay(normalized);
    this.logEntryCounter = restored.length;
    this._messages = restored;
    this.callbacks.requestUpdate();
  }

  private parseConversationHistoryForDisplay(history: string): PanelDetailLogEntry[] {
    const lines = history.split("\n");
    const entries: Array<{ text: string; role: ConversationRole }> = [];
    let currentRole: ConversationRole | null = null;
    let currentLines: string[] = [];

    const commit = () => {
      if (currentRole && currentLines.length) {
        entries.push({
          text: currentLines.join("\n").trim(),
          role: currentRole
        });
      }
      currentLines = [];
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      const role = parseRoleLine(line);
      
      if (role) {
        commit();
        currentRole = role;
        continue;
      }

      // Content line - accumulate under current role
      if (currentRole) {
        currentLines.push(line);
      } else {
        // Legacy: lines before any role marker treated as server content
        currentRole = "Server";
        currentLines.push(line);
      }
    }

    commit();

    return entries.map((entry, index) => ({
      id: `log-${index + 1}`,
      kind: "text",
      text: entry.text,
      role: entry.role,
      isUser: ROLE_REGISTRY[entry.role].isUser
    }));
  }

  private detectRoleFromMessage(message: string): ConversationRole | null {
    const firstLine = message.split(/\r?\n/, 1)[0] ?? "";
    return parseRoleLine(firstLine);
  }
}
