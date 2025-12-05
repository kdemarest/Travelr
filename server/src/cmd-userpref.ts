import type { UserPrefCommand } from "./command-types.js";
import { registerCommand } from "./command-registry.js";
import { CommandError } from "./errors.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdUserpref()
{
  function parseUserPref(command: CommandWithArgs): UserPrefCommand {
    const entries = Object.entries(command.args);
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
    return { commandId: "userpref", key: key.trim(), value };
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

  function handleUserpref(
    command: CommandWithArgs,
    ctx: CommandContext
  ): CommandHandlerResult {
    const parsed = parseUserPref(command);
    const key = parsed.key;
    console.log("Handling /userpref command", { userId: ctx.user.userId, key });

    try {
      const normalizedValue = normalizeUserPrefValue(parsed.value);
      const prefs = ctx.user.prefsFile;
      prefs.data[key] = normalizedValue;
      prefs.setDirty();
      
      return {
        message: `Stored preference "${key}".`
      };
    } catch (error) {
      console.error("Failed to update user preference", { key, error });
      return {
        message: "Failed to update user preferences.",
        stopProcessingCommands: true
      };
    }
  }

  return { commandId: "userpref", parser: parseUserPref, handler: handleUserpref };
}
registerCommand(cmdUserpref());
