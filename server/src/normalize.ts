import { CommandError } from "./errors.js";
import type { CanonicalCommandContext, ParsedCommand } from "./command.js";
import { normalizeUserDate } from "./normalize-date.js";
import { normalizeUserTime } from "./normalize-time.js";
import { generateUid } from "./uid.js";

const KNOWN_COMMANDS = new Set([
  "/newtrip",
  "/add",
  "/edit",
  "/delete",
  "/help",
  "/trip",
  "/model",
  "/undo",
  "/redo",
  "/websearch",
  "/addcountry",
  "/refreshcountries",
  "/userpref",
  "/mark"
]);

const DATE_ARG_PATTERN = /\bdate=("(?:\\.|[^"\\])*"|[^\s]+)/gi;
const TIME_ARG_PATTERN = /\btime=("(?:\\.|[^"\\])*"|[^\s]+)/gi;

export interface FocusSummaryDetails {
  focusedActivityUid?: string | null;
}

export interface CommandTextNormalizationOptions {
  focus?: FocusSummaryDetails;
  referenceDate?: Date;
}

export type NormalizedParsedCommand = {
  command: ParsedCommand;
  context?: CanonicalCommandContext;
};

export function parseFocusSummary(input?: string): FocusSummaryDetails {
  if (typeof input !== "string" || !input.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(input);
    const focusedActivityUid = typeof parsed?.focusedActivityUid === "string" ? parsed.focusedActivityUid : null;
    return { focusedActivityUid };
  } catch {
    return {};
  }
}

export function normalizeCommandLine(line: string, options: CommandTextNormalizationOptions = {}): string {
  let current = line;
  current = convertUnknownCommandToEdit(current, options.focus?.focusedActivityUid ?? null);
  current = injectFocusedUidIntoEdit(current, options.focus?.focusedActivityUid ?? null);
  current = normalizeDateFields(current, options.referenceDate ?? new Date());
  current = normalizeTimeFields(current);
  return current;
}

const UID_ARG_PATTERN = /\buid=/i;
const LINE_NUM_ARG_PATTERN = /\blineNum=/i;

export function augmentCommandLine(
  line: string,
  generateUid: () => string,
  getNextLineNumber: () => number
): string {
  const trimmed = line.trimStart();
  if (!trimmed.startsWith("/")) {
    return line;
  }

  let result = line;
  const commandKeyword = trimmed.split(/\s+/, 1)[0].toLowerCase();

  if (commandKeyword === "/add" && UID_ARG_PATTERN.test(result)) {
    throw new CommandError("/add commands cannot include uid. The server assigns one automatically.");
  }

  if (LINE_NUM_ARG_PATTERN.test(result)) {
    throw new CommandError("Commands cannot include lineNum. The server assigns it automatically.");
  }

  if (commandKeyword === "/add") {
    const uid = generateUid();
    result = appendArgument(result, `uid="${uid}"`);
  }

  if (isCommandJournalable(commandKeyword)) {
    const lineNumber = getNextLineNumber();
    result = appendArgument(result, `lineNum=${lineNumber}`);
  }

  return result;
}

export function normalizeParsedCommand(command: ParsedCommand): NormalizedParsedCommand {
  if (command.type === "add") {
    if (command.uid) {
      throw new CommandError("/add commands cannot specify uid. The server assigns one automatically.");
    }
    const generatedUid = generateUid();
    return {
      command: { ...command, uid: generatedUid },
      context: { generatedUid }
    };
  }

  return { command };
}

function convertUnknownCommandToEdit(line: string, focusedUid: string | null): string {
  if (!focusedUid) {
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
  return `${leadingWhitespace}/edit ${focusedUid} ${fieldName}=${encodedValue}`;
}

function injectFocusedUidIntoEdit(line: string, focusedUid: string | null): string {
  if (!focusedUid) {
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
  return `${leadingWhitespace}/edit ${focusedUid}${spacer}${rest}`;
}

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

function appendArgument(line: string, argument: string): string {
  const trimmedEnd = line.trimEnd();
  const trailingWhitespace = line.slice(trimmedEnd.length);
  const separator = trimmedEnd.length ? " " : "";
  return `${trimmedEnd}${separator}${argument}${trailingWhitespace}`;
}

function isCommandJournalable(keyword: string): boolean {
  switch (keyword) {
    case "/add":
    case "/edit":
    case "/delete":
    case "/undo":
    case "/redo":
    case "/addcountry":
      return true;
    default:
      return false;
  }
}
