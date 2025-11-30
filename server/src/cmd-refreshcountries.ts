import type { ParsedCommand } from "./command.js";
import type { CommandResponse } from "./cmd-help.js";
import { refreshCountryCatalog } from "./refresh-countries.js";

export async function cmdRefreshcountries(parsed: ParsedCommand): Promise<CommandResponse> {
  if (parsed.type !== "refreshcountries") {
    throw new Error("cmdRefreshcountries called with non-refreshcountries command");
  }

  console.log("Handling /refreshcountries command");

  try {
    const summary = await refreshCountryCatalog();
    const message = `Updated ${summary.updated} countries, added ${summary.added}.`;
    return {
      status: 200,
      body: {
        ok: true,
        executedCommands: 0,
        message,
        summary
      }
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Country refresh failed.";
    return {
      status: 502,
      body: {
        ok: false,
        error: message
      }
    };
  }
}
