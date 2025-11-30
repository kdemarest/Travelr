import type { ParsedCommand } from "./command.js";
import type { CommandResponse } from "./cmd-help.js";
import { handleGoogleSearch } from "./search.js";

export async function cmdWebsearch(parsed: ParsedCommand): Promise<CommandResponse> {
  if (parsed.type !== "websearch") {
    throw new Error("cmdWebsearch called with non-websearch command");
  }

  const query = parsed.query;

  try {
    console.log("Starting Google Custom Search", { query });
    const { snippets } = await handleGoogleSearch(query);
    console.log("Google Custom Search finished", { query, snippetCount: snippets.length });
    const count = snippets.length;
    const summary = count === 0
      ? `Web search found no results for "${query}".`
      : `Web search found ${count} result${count === 1 ? "" : "s"} for "${query}".`;
    return {
      status: 200,
      body: {
        ok: true,
        executedCommands: 0,
        message: summary,
        query,
        searchResults: snippets
      }
    };
  } catch (error) {
    return {
      status: 502,
      body: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}
