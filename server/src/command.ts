import { CommandError } from "./errors.js";

export type ParsedCommand =
  | NewTripCommand
  | AddCommand
  | EditCommand
  | DeleteCommand
  | MoveDateCommand
  | UndoCommand
  | RedoCommand
  | HelpCommand
  | RenormalizeCommand
  | TripCommand
  | ModelCommand
  | WebSearchCommand
  | InfoCommand;

export interface NewTripCommand {
  type: "newtrip";
  tripId: string;
}

export interface AddCommand {
  type: "add";
  activityType: string;
  fields: Record<string, string>;
  uid?: string;
}

export interface EditCommand {
  type: "edit";
  uid: string;
  changes: Record<string, string>;
}

export interface DeleteCommand {
  type: "delete";
  uid: string;
}

export interface HelpCommand {
  type: "help";
}

export interface RenormalizeCommand {
  type: "renormalize";
}

export interface TripCommand {
  type: "trip";
  target?: string;
}

export interface ModelCommand {
  type: "model";
  target?: string;
}

export interface WebSearchCommand {
  type: "websearch";
  query: string;
}

export interface InfoCommand {
  type: "info";
  topic?: string;
}

export interface MoveDateCommand {
  type: "movedate";
  from: string;
  to: string;
}

export interface UndoCommand {
  type: "undo";
  count: number;
}

export interface RedoCommand {
  type: "redo";
  count: number;
}

const TRIP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TRIP_ID_ARG_PATTERN = /\btripId="([^"]+)"/;
const ARG_PATTERN = /([A-Za-z0-9_-]+)=("(?:[^"\\]|\\.)*"|[^\s]+)/g;
const ACTIVITY_TYPES = new Set(["flight", "lodging", "transport", "rentalCar", "visit", "meal", "hike"]);

export function parseCommand(line: string): ParsedCommand {
  const trimmed = line.trim();
  if (!trimmed.startsWith("/")) {
    throw new CommandError("Commands must start with a slash (/) prefix.");
  }

  const spaceIndex = trimmed.indexOf(" ");
  const keyword = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  const argsText = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex + 1).trim();

  switch (keyword) {
    case "/newtrip":
      return parseNewTrip(argsText);
    case "/add":
      return parseAdd(argsText);
    case "/edit":
      return parseEdit(argsText);
    case "/delete":
      return parseDelete(argsText);
    case "/help":
      return { type: "help" };
    case "/renormalize":
      return { type: "renormalize" };
    case "/trip":
      return parseTrip(argsText);
    case "/model":
      return parseModel(argsText);
    case "/websearch":
      return parseWebSearch(argsText);
    case "/info":
      return parseInfo(argsText);
    case "/movedate":
      return parseMoveDate(argsText);
    case "/undo":
      return parseUndo(argsText);
    case "/redo":
      return parseRedo(argsText);
    default:
      throw new CommandError(`Unsupported command ${keyword}.`);
  }
}

function parseNewTrip(argsText: string): NewTripCommand {
  const { value: positionalTripId, rest, consumed } = consumeLeadingBareValue(argsText);
  const argsRemainder = consumed ? rest : argsText;
  const tripIdMatch = argsRemainder.match(TRIP_ID_ARG_PATTERN);
  const tripId = positionalTripId ?? tripIdMatch?.[1];
  if (!tripId) {
    throw new CommandError("/newtrip requires a tripId (positional or tripId=\"...\").");
  }

  if (!TRIP_ID_PATTERN.test(tripId)) {
    throw new CommandError("tripId may only contain letters, numbers, underscore, or dash.");
  }

  return { type: "newtrip", tripId };
}

function parseAdd(argsText: string): AddCommand {
  const { value: positionalType, rest, consumed } = consumeLeadingBareValue(argsText);
  const fields = parseArgs(consumed ? rest : argsText);
  const { activityType, uid: presetUid, ...restFields } = fields;
  const finalType = positionalType ?? activityType;
  if (!finalType) {
    throw new CommandError("/add requires an activityType (positional or activityType=...).");
  }

  if (!ACTIVITY_TYPES.has(finalType)) {
    throw new CommandError(`activityType must be one of: ${Array.from(ACTIVITY_TYPES).join(", ")}`);
  }

  return { type: "add", activityType: finalType, fields: restFields, uid: presetUid };
}

function parseTrip(argsText: string): TripCommand {
  const { value: target } = consumeLeadingBareValue(argsText);
  return { type: "trip", target: target?.trim() || undefined };
}

function parseModel(argsText: string): ModelCommand {
  const { value: target } = consumeLeadingBareValue(argsText);
  return { type: "model", target: target?.trim() || undefined };
}

function parseWebSearch(argsText: string): WebSearchCommand {
  const { value: positionalQuery, rest, consumed } = consumeLeadingBareValue(argsText);
  const fields = parseArgs(consumed ? rest : argsText);
  const query = positionalQuery ?? fields.query;
  if (!query || !query.trim()) {
    throw new CommandError("/websearch requires a query (positional or query=\"...\").");
  }
  return { type: "websearch", query: query.trim() };
}

function parseInfo(argsText: string): InfoCommand {
  const { value: topic } = consumeLeadingBareValue(argsText);
  return { type: "info", topic: topic?.trim() || undefined };
}

function parseEdit(argsText: string): EditCommand {
  const { value: positionalUid, rest, consumed } = consumeLeadingBareValue(argsText);
  const fields = parseArgs(consumed ? rest : argsText);
  const { uid: uidField, ...changes } = fields;
  const uid = positionalUid ?? uidField;
  if (!uid) {
    throw new CommandError("/edit requires uid (positional or uid=...).");
  }

  if (Object.keys(changes).length === 0) {
    throw new CommandError("/edit requires at least one field to modify.");
  }

  return { type: "edit", uid, changes };
}

function parseDelete(argsText: string): DeleteCommand {
  const { value: positionalUid, rest, consumed } = consumeLeadingBareValue(argsText);
  const fields = parseArgs(consumed ? rest : argsText);
  const uid = positionalUid ?? fields.uid;
  if (!uid) {
    throw new CommandError("/delete requires uid (positional or uid=...).");
  }
  return { type: "delete", uid };
}

function parseMoveDate(argsText: string): MoveDateCommand {
  const fields = parseArgs(argsText);
  const from = fields.from?.trim();
  const to = fields.to?.trim();
  if (!from || !to) {
    throw new CommandError("/movedate requires from and to date values.");
  }
  return { type: "movedate", from, to };
}

function parseUndo(argsText: string): UndoCommand {
  const count = parseUndoRedoCount(argsText, "/undo");
  return { type: "undo", count };
}

function parseRedo(argsText: string): RedoCommand {
  const count = parseUndoRedoCount(argsText, "/redo");
  return { type: "redo", count };
}

function parseUndoRedoCount(argsText: string, keyword: string): number {
  const trimmed = argsText.trim();
  if (!trimmed) {
    return 1;
  }

  const { value: positionalCount, rest, consumed } = consumeLeadingBareValue(argsText);
  const args = parseArgs(consumed ? rest : argsText);
  const rawCount = positionalCount ?? args.count ?? args.steps;
  if (!rawCount) {
    return 1;
  }

  const count = Number(rawCount);
  if (!Number.isFinite(count) || !Number.isInteger(count) || count < 1) {
    throw new CommandError(`${keyword} requires a positive integer count.`);
  }
  return count;
}

function parseArgs(input: string): Record<string, string> {
  const args: Record<string, string> = {};
  if (!input) {
    return args;
  }

  const matches = input.matchAll(ARG_PATTERN);
  for (const match of matches) {
    const [, key, rawValue] = match;
    args[key] = decodeValue(rawValue ?? "");
  }

  return args;
}

function decodeValue(raw: string): string {
  if (raw.startsWith("\"")) {
    try {
      return JSON.parse(raw);
    } catch (error) {
      throw new CommandError("Invalid quoted string literal in command.");
    }
  }

  return raw;
}

function consumeLeadingBareValue(input: string): { value?: string; rest: string; consumed: boolean } {
  const trimmed = input.trimStart();
  if (!trimmed) {
    return { rest: "", consumed: false };
  }

  if (trimmed.startsWith("\"")) {
    let index = 1;
    let escaped = false;
    while (index < trimmed.length) {
      const char = trimmed[index];
      if (char === "\"" && !escaped) {
        const token = trimmed.slice(0, index + 1);
        const rest = trimmed.slice(index + 1).trimStart();
        return { value: decodeValue(token), rest, consumed: true };
      }
      if (char === "\\" && !escaped) {
        escaped = true;
      } else {
        escaped = false;
      }
      index += 1;
    }
    return { rest: trimmed, consumed: false };
  }

  const spaceIndex = trimmed.search(/\s/);
  const token = spaceIndex === -1 ? trimmed : trimmed.slice(0, spaceIndex);
  if (token.includes("=")) {
    return { rest: trimmed, consumed: false };
  }

  const rest = spaceIndex === -1 ? "" : trimmed.slice(spaceIndex).trimStart();
  return { value: token, rest, consumed: true };
}

export function extractSlashCommandLines(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .map((line) => line.trimStart())
    .filter((line) => line.startsWith("/"))
    .filter((line) => line.length > 0);
}

export type CanonicalCommandContext = {
  deletedActivity?: Record<string, unknown> | null;
  generatedUid?: string;
};

export function formatCanonicalCommand(command: ParsedCommand, context?: CanonicalCommandContext): string {
  switch (command.type) {
    case "newtrip":
      return parts("/newtrip", formatArg("tripId", command.tripId));
    case "add": {
      const fieldArgs = Object.entries(command.fields).map(([key, value]) => formatArg(key, value));
      return parts(
        "/add",
        formatArg("activityType", command.activityType),
        ...fieldArgs,
        formatArg("uid", command.uid ?? context?.generatedUid)
      );
    }
    case "edit": {
      const changeArgs = Object.entries(command.changes).map(([key, value]) => formatArg(key, value));
      return parts("/edit", formatArg("uid", command.uid), ...changeArgs);
    }
    case "delete": {
      // Include a snapshot of the soon-to-be-removed activity so clients can still render
      // rich delete command chips even after the activity disappears from the trip model.
      const deletedArgs = context?.deletedActivity
        ? Object.keys(context.deletedActivity)
            .sort((a, b) => a.localeCompare(b))
            .map((key) => formatArg(key, context.deletedActivity?.[key]))
            .filter((segment): segment is string => Boolean(segment))
        : [];
      return parts("/delete", formatArg("uid", command.uid), ...deletedArgs);
    }
    case "help":
      return "/help";
    case "renormalize":
      return "/renormalize";
    case "trip":
      return command.target ? parts("/trip", formatArg("target", command.target)) : "/trip";
    case "model":
      return command.target ? parts("/model", formatArg("target", command.target)) : "/model";
    case "websearch":
      return parts("/websearch", formatArg("query", command.query));
    case "info":
      return command.topic ? parts("/info", formatArg("topic", command.topic)) : "/info";
    case "movedate":
      return parts("/movedate", formatArg("from", command.from), formatArg("to", command.to));
    case "undo":
      return parts("/undo", formatArg("count", command.count));
    case "redo":
      return parts("/redo", formatArg("count", command.count));
    default:
      return "/help";
  }
}

function parts(...segments: Array<string | null | undefined>): string {
  return segments.filter((segment): segment is string => Boolean(segment && segment.length > 0)).join(" ").trim();
}

function formatArg(key: string, value: unknown): string | null {
  if (value === undefined) {
    return null;
  }
  return `${key}=${formatValue(value)}`;
}

function formatValue(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || value === undefined) {
    return "\"\"";
  }
  return JSON.stringify(String(value));
}
