import type { ParsedCommand } from "./command.js";
import type { CommandResponse } from "./cmd-help.js";
import { normalizeAllJournals } from "./journal-normalizer.js";

export async function cmdRenormalize(parsed: ParsedCommand, dataDir: string): Promise<CommandResponse> {
  if (parsed.type !== "renormalize") {
    throw new Error("cmdRenormalize called with non-renormalize command");
  }

  console.log("Handling /renormalize command");
  const summary = await normalizeAllJournals(dataDir);
  const successCount = summary.results.length;
  const failureCount = summary.failures.length;
  const messageBase = `Re-normalized ${successCount} of ${summary.discovered} journal${
    summary.discovered === 1 ? "" : "s"
  }.`;
  const message =
    failureCount === 0
      ? messageBase
      : `${messageBase} ${failureCount} file${failureCount === 1 ? "" : "s"} failed.`;

  return {
    status: failureCount ? 207 : 200,
    body: {
      ok: failureCount === 0,
      executedCommands: 0,
      message,
      normalized: summary.results.map((result) => ({
        filePath: result.filePath,
        tempPath: result.tempPath,
        normalizedLines: result.normalizedLines,
        skippedLines: result.skippedLines,
        warnings: result.warnings
      })),
      failures: summary.failures
    }
  };
}
