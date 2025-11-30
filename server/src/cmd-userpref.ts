import type { ParsedCommand } from "./command.js";
import type { CommandResponse } from "./cmd-help.js";
import { setUserPreference } from "./user-preferences.js";

export async function cmdUserpref(parsed: ParsedCommand): Promise<CommandResponse> {
  if (parsed.type !== "userpref") {
    throw new Error("cmdUserpref called with non-userpref command");
  }

  console.log("Handling /userpref command", { key: parsed.key });

  try {
    const normalizedValue = normalizeUserPrefValue(parsed.value);
    const preferences = await setUserPreference(parsed.key, normalizedValue);
    return {
      status: 200,
      body: {
        ok: true,
        message: `Stored preference "${parsed.key}".`,
        key: parsed.key,
        value: preferences[parsed.key],
        preferences
      }
    };
  } catch (error) {
    console.error("Failed to update user preference", { key: parsed.key, error });
    return {
      status: 500,
      body: { error: "Failed to update user preferences." }
    };
  }
}

function normalizeUserPrefValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
