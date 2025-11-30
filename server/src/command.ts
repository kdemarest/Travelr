import { CommandError } from "./errors.js";

export type ParsedCommand =
  | NewTripCommand
  | AddCommand
  | EditCommand
  | DeleteCommand
  | UndoCommand
  | RedoCommand
  | HelpCommand
  | RenormalizeCommand
  | TripCommand
  | ModelCommand
  | WebSearchCommand
  | AddCountryCommand
  | RefreshCountriesCommand
  | UserPrefCommand
  | MarkCommand
  | IntentCommand
  | MoveDayCommand
  | InsertDayCommand
  | RemoveDayCommand;

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

export interface AddCountryCommand {
  type: "addcountry";
  countryName: string;
  countryAlpha2?: string;
  currencyAlpha3?: string;
  id?: string;
  exchangeRateToUSD?: number;
  exchangeRateLastUpdate?: string;
}

export interface RefreshCountriesCommand {
  type: "refreshcountries";
}

export interface UserPrefCommand {
  type: "userpref";
  key: string;
  value: unknown;
}

export interface UndoCommand {
  type: "undo";
  count: number;
}

export interface RedoCommand {
  type: "redo";
  count: number;
}

export interface MarkCommand {
  type: "mark";
  markType: "activities" | "dates";
  add: string[];
  remove: string[];
}

export interface IntentCommand {
  type: "intent";
  what: string;
}

export interface MoveDayCommand {
  type: "moveday";
  from: string;  // YYYY-MM-DD format
  to: string;    // YYYY-MM-DD format
}

export interface InsertDayCommand {
  type: "insertday";
  after: string;  // Insert a blank day after this date, pushing subsequent days forward
}

export interface RemoveDayCommand {
  type: "removeday";
  date: string;   // Remove this day, pulling subsequent days backward
}

const TRIP_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const TRIP_ID_ARG_PATTERN = /\btripId="([^"]+)"/;
const ARG_PATTERN = /([A-Za-z0-9_-]+)=("(?:[^"\\]|\\.)*"|[^\s]+)/g;

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
    case "/addcountry":
      return parseAddCountry(argsText);
    case "/refreshcountries":
      return { type: "refreshcountries" };
    case "/userpref":
      return parseUserPref(argsText);
    case "/undo":
      return parseUndo(argsText);
    case "/redo":
      return parseRedo(argsText);
    case "/mark":
      return parseMark(argsText);
    case "/intent":
      return parseIntent(argsText);
    case "/moveday":
      return parseMoveDay(argsText);
    case "/insertday":
      return parseInsertDay(argsText);
    case "/removeday":
      return parseRemoveDay(argsText);
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

function parseAddCountry(argsText: string): AddCountryCommand {
  const { value: positionalCountry, rest, consumed } = consumeLeadingBareValue(argsText);
  const fields = parseArgs(consumed ? rest : argsText);
  const countryName = positionalCountry ?? fields.countryName ?? fields.country ?? fields.name;
  if (!countryName || !countryName.trim()) {
    throw new CommandError("/addcountry requires countryName (positional or countryName=...)");
  }
  const countryAlpha2 = fields.countryAlpha2 ?? fields.isoCountry ?? fields.code;
  const currencyAlpha3 = fields.currencyAlpha3 ?? fields.isoCurrency ?? fields.currency;
  const id = fields.id ?? fields.countryId;
  const rateRaw = fields.exchangeRateToUSD ?? fields.rate ?? fields.fx ?? fields.exchangeRate;
  let exchangeRateToUSD: number | undefined;
  if (rateRaw !== undefined) {
    const parsed = Number(rateRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new CommandError("exchangeRateToUSD must be a positive number.");
    }
    exchangeRateToUSD = parsed;
  }
  const exchangeRateLastUpdate = fields.exchangeRateLastUpdate ?? fields.rateDate ?? fields.rateTimestamp;
  const normalizedRateDate = typeof exchangeRateLastUpdate === "string" ? exchangeRateLastUpdate.trim() : undefined;
  return {
    type: "addcountry",
    countryName: countryName.trim(),
    countryAlpha2: countryAlpha2?.trim(),
    currencyAlpha3: currencyAlpha3?.trim(),
    id: id?.trim(),
    exchangeRateToUSD,
    exchangeRateLastUpdate: normalizedRateDate
  };
}

function parseUserPref(argsText: string): UserPrefCommand {
  const entries = Object.entries(parseArgs(argsText));
  if (entries.length === 0) {
    throw new CommandError("/userpref requires at least one key=value pair.");
  }
  if (entries.length > 1) {
    throw new CommandError("/userpref accepts exactly one key=value pair.");
  }
  const [key, value] = entries[0];
  if (!key?.trim()) {
    throw new CommandError("/userpref key cannot be empty.");
  }
  return { type: "userpref", key: key.trim(), value };
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

function parseUndo(argsText: string): UndoCommand {
  const count = parseUndoRedoCount(argsText, "/undo");
  return { type: "undo", count };
}

function parseRedo(argsText: string): RedoCommand {
  const count = parseUndoRedoCount(argsText, "/redo");
  return { type: "redo", count };
}

function parseMark(argsText: string): MarkCommand {
  const args = parseArgs(argsText);
  const markType = (args.type?.toLowerCase() ?? "activities") as "activities" | "dates";
  
  if (markType !== "activities" && markType !== "dates") {
    throw new CommandError("/mark type must be \"activities\" or \"dates\".");
  }
  
  const addStr = args.add ?? "";
  const removeStr = args.remove ?? "";
  
  if (!addStr && !removeStr) {
    throw new CommandError("/mark requires at least one of add=\"...\" or remove=\"...\".");
  }
  
  const add = addStr ? addStr.split(/\s+/).filter(Boolean) : [];
  const remove = removeStr ? removeStr.split(/\s+/).filter(Boolean) : [];
  
  return { type: "mark", markType, add, remove };
}

function parseIntent(argsText: string): IntentCommand {
  const args = parseArgs(argsText);
  const what = args.what?.trim();
  if (!what) {
    throw new CommandError("/intent requires what=\"...\"");
  }
  return { type: "intent", what };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseMoveDay(argsText: string): MoveDayCommand {
  const args = parseArgs(argsText);
  const from = args.from?.trim();
  const to = args.to?.trim();
  
  if (!from) {
    throw new CommandError("/moveday requires from=\"YYYY-MM-DD\"");
  }
  if (!to) {
    throw new CommandError("/moveday requires to=\"YYYY-MM-DD\"");
  }
  if (!DATE_PATTERN.test(from)) {
    throw new CommandError(`Invalid from date "${from}". Must be YYYY-MM-DD format.`);
  }
  if (!DATE_PATTERN.test(to)) {
    throw new CommandError(`Invalid to date "${to}". Must be YYYY-MM-DD format.`);
  }
  
  return { type: "moveday", from, to };
}

function parseInsertDay(argsText: string): InsertDayCommand {
  const args = parseArgs(argsText);
  const after = args.after?.trim();
  if (!after) {
    throw new CommandError("/insertday requires after=\"YYYY-MM-DD\"");
  }
  if (!DATE_PATTERN.test(after)) {
    throw new CommandError(`Invalid date "${after}". Must be YYYY-MM-DD format.`);
  }
  return { type: "insertday", after };
}

function parseRemoveDay(argsText: string): RemoveDayCommand {
  const args = parseArgs(argsText);
  const date = args.date?.trim();
  if (!date) {
    throw new CommandError("/removeday requires date=\"YYYY-MM-DD\"");
  }
  if (!DATE_PATTERN.test(date)) {
    throw new CommandError(`Invalid date "${date}". Must be YYYY-MM-DD format.`);
  }
  return { type: "removeday", date };
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
    case "addcountry":
      return parts(
        "/addcountry",
        formatArg("countryName", command.countryName),
        formatArg("countryAlpha2", command.countryAlpha2),
        formatArg("currencyAlpha3", command.currencyAlpha3),
        formatArg("id", command.id),
        formatArg("exchangeRateToUSD", command.exchangeRateToUSD),
        formatArg("exchangeRateLastUpdate", command.exchangeRateLastUpdate)
      );
    case "refreshcountries":
      return "/refreshcountries";
    case "userpref":
      return parts("/userpref", formatArg(command.key, command.value));
    case "undo":
      return parts("/undo", formatArg("count", command.count));
    case "redo":
      return parts("/redo", formatArg("count", command.count));
    case "mark":
      return parts(
        "/mark",
        formatArg("type", command.markType),
        command.add.length > 0 ? formatArg("add", command.add.join(" ")) : null,
        command.remove.length > 0 ? formatArg("remove", command.remove.join(" ")) : null
      );
    case "intent":
      return parts("/intent", formatArg("what", command.what));
    case "moveday":
      return parts("/moveday", formatArg("from", command.from), formatArg("to", command.to));
    case "insertday":
      return parts("/insertday", formatArg("after", command.after));
    case "removeday":
      return parts("/removeday", formatArg("date", command.date));
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
