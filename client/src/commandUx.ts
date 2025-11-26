import type { TripModel } from "./types";
import { normalizeUserDate } from "./ux-date";
import { normalizeUserTime } from "./ux-time";

const KNOWN_COMMANDS = new Set([
  "/newtrip",
  "/add",
  "/edit",
  "/delete",
  "/help",
  "/trip",
  "/model",
  "/movedate",
  "/undo",
  "/redo",
  "/websearch"
]);

export interface CommandProcessingResult {
  ok: boolean;
  executedCommands: number;
  skipped: boolean;
  payload?: CommandResponse;
}

interface CommandResponse {
  ok?: boolean;
  executedCommands?: number;
  message?: string;
  error?: string;
  model?: TripModel;
  query?: string;
  searchResults?: string[];
}

export interface CommandUxOptions {
  text: string;
  currentTripId: string;
  selectedUid: string | null;
  appendMessage: (message: string, options?: { isUser?: boolean; conversationText?: string }) => void;
  setSending: (sending: boolean) => void;
  rememberTripModel: (model: TripModel) => void;
  echoCommands?: boolean;
}

export async function processUserCommand(options: CommandUxOptions): Promise<CommandProcessingResult> {
  const preparedText = prepareOutgoingText(options.text, options.selectedUid);
  if (options.echoCommands ?? true) {
    options.appendMessage(preparedText, {
      isUser: true,
      conversationText: `User: ${preparedText}`
    });
  }
  const hasSlashCommands = containsSlashCommand(preparedText);
  if (!hasSlashCommands) {
    return { ok: true, executedCommands: 0, skipped: true };
  }

  options.setSending(true);

  try {
    const response = await fetch(`/api/trip/${options.currentTripId}/command`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: preparedText })
    });
    const payload = (await response.json().catch(() => ({}))) as CommandResponse;

    if (!response.ok) {
      options.appendMessage(`✗ ${payload.error ?? response.statusText}`);
      return { ok: false, executedCommands: 0, skipped: false, payload };
    }

    if (payload.message && !payload.searchResults) {
      options.appendMessage(`ℹ ${payload.message}`);
    }

    if (payload.model) {
      options.rememberTripModel(payload.model);
    }

    const executed = payload.executedCommands ?? 0;
    if (executed > 0) {
      options.appendMessage(`✓ Executed ${executed} command(s)`);
    }
    return { ok: true, executedCommands: executed, skipped: false, payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.appendMessage(`Network error: ${message}`);
    return { ok: false, executedCommands: 0, skipped: false };
  } finally {
    options.setSending(false);
  }
}

export function prepareOutgoingText(input: string, selectedUid: string | null, referenceDate = new Date()): string {
  return input
    .split(/\r?\n/)
    .map((line) => convertUnknownCommandToEdit(line, selectedUid))
    .map((line) => injectSelectedUidIntoEdit(line, selectedUid))
    .map((line) => normalizeDateFields(line, referenceDate))
    .map((line) => normalizeTimeFields(line))
    .join("\n");
}

function convertUnknownCommandToEdit(line: string, selectedUid: string | null): string {
  if (!selectedUid) {
    return line;
  }

  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) {
    return line;
  }

  const leadingWhitespace = line.slice(0, line.length - trimmed.length);
  const spaceIndex = trimmed.indexOf(" ");
  const keyword = (spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex)).toLowerCase();
  if (KNOWN_COMMANDS.has(keyword)) {
    return line;
  }

  const fieldName = keyword.slice(1);
  if (!fieldName) {
    return line;
  }

  const rawValue = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();
  if (!rawValue) {
    return line;
  }

  const encodedValue = JSON.stringify(rawValue);
  return `${leadingWhitespace}/edit ${selectedUid} ${fieldName}=${encodedValue}`;
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

export function injectSelectedUidIntoEdit(line: string, selectedUid: string | null): string {
  if (!selectedUid) {
    return line;
  }

  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/edit")) {
    return line;
  }

  const leadingWhitespaceLength = line.length - trimmed.length;
  const leadingWhitespace = line.slice(0, leadingWhitespaceLength);
  const afterKeyword = trimmed.slice("/edit".length);
  if (/(^|\s)uid=/.test(afterKeyword)) {
    return line;
  }

  const rest = afterKeyword.trimStart();
  if (rest) {
    const firstToken = rest.split(/\s+/)[0];
    if (firstToken && !firstToken.includes("=")) {
      return line;
    }
  }

  const spacer = rest.length ? " " : "";
  return `${leadingWhitespace}/edit ${selectedUid}${spacer}${rest}`;
}

export function extractSlashCommandLines(text: string): string[] {
  const lines = text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .map((line) => line.trimStart())
    .filter((line) => line.startsWith("/"))
    .filter((line) => line.length > 0);
  if (lines.length) {
    console.log("extractSlashCommandLines detected commands", {
      commandCount: lines.length,
      preview: lines.slice(0, 5)
    });
  } else {
    console.log("extractSlashCommandLines found no commands", {
      snippet: text.slice(0, 120)
    });
  }
  return lines;
}

function containsSlashCommand(text: string): boolean {
  return extractSlashCommandLines(text).length > 0;
}
