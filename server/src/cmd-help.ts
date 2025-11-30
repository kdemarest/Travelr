import type { ParsedCommand } from "./command.js";

export interface CommandResponse {
  status: number;
  body: Record<string, unknown>;
}

export function cmdHelp(_parsed: ParsedCommand): CommandResponse {
  return {
    status: 200,
    body: {
      ok: true,
      executedCommands: 0,
      message: buildHelpMessage()
    }
  };
}

function buildHelpMessage(): string {
  return [
    "Available slash commands:",
    "",
    "/help - Show this list.",
    '/newtrip tripId="<id>" - Required: tripId (letters, numbers, _ or -). Creates or resets the trip.',
    '/add activityType=<flight|lodging|rentalCar|transport|visit|meal|hike> field="value" ... - Required: activityType plus at least one additional field (name=, date=, etc.).',
    '/edit uid=<activity-uid> field="value" ... - Required: uid and at least one field to update. Values use key=value syntax; wrap spaces in quotes.',
    '/delete uid=<activity-uid> - Removes the activity from the trip.',
    '/trip [tripId] - Without args lists known trips; with tripId it loads that trip for editing.',
    '/model [modelName] - Without args lists supported GPT models; with modelName switches the active model.',
    '/websearch query="search" - Performs a background web search (results currently hidden).',
    '/userpref anyKey="value" - Updates the stored user preferences; accepts any key name (value may be JSON).',
    '/renormalize - Maintenance command that rewrites every journal into canonical form. Run manually; the chatbot never invokes this.'
  ].join("\n");
}
