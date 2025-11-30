import fs from "fs-extra";
import path from "node:path";
import {
  formatCanonicalCommand,
  parseCommand,
  type CanonicalCommandContext,
  type ParsedCommand
} from "./command.js";
import { applyTripCommand } from "./reducer.js";
import type { TripModel } from "./types.js";
import { ensureDefaultCountry } from "./country-defaults.js";

export const JOURNAL_EXTENSION = ".travlrjournal";

export interface JournalNormalizationResult {
  filePath: string;
  tempPath: string;
  normalizedLines: number;
  skippedLines: number;
  warnings: string[];
}

export interface JournalNormalizationFailure {
  filePath: string;
  error: string;
}

export interface JournalNormalizationSummary {
  dataDir: string;
  discovered: number;
  normalized: number;
  results: JournalNormalizationResult[];
  failures: JournalNormalizationFailure[];
}

export async function normalizeAllJournals(dataDir: string): Promise<JournalNormalizationSummary> {
  await fs.ensureDir(dataDir);
  const entries = await fs.readdir(dataDir);
  const journalFiles = entries
    .filter((entry) => entry.endsWith(JOURNAL_EXTENSION))
    .map((entry) => path.join(dataDir, entry));

  const results: JournalNormalizationResult[] = [];
  const failures: JournalNormalizationFailure[] = [];

  for (const filePath of journalFiles) {
    try {
      const result = await normalizeJournalFile(filePath);
      results.push(result);
    } catch (error) {
      failures.push({
        filePath,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return {
    dataDir,
    discovered: journalFiles.length,
    normalized: results.length,
    results,
    failures
  };
}

export async function normalizeJournalFile(filePath: string): Promise<JournalNormalizationResult> {
  const raw = await fs.readFile(filePath, "utf8");
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  const tripName = path.basename(filePath, JOURNAL_EXTENSION);
  const normalized: string[] = [];
  const history: ParsedCommand[] = [];
  let head = 0;
  let model: TripModel = ensureDefaultCountry({ tripName, tripId: tripName, activities: [], countries: [] });
  let modelDirty = true;
  let normalizedLines = 0;
  let skippedLines = 0;
  const warnings: string[] = [];

  const ensureModel = () => {
    if (!modelDirty) {
      return model;
    }
    let current: TripModel = ensureDefaultCountry({ tripName, tripId: tripName, activities: [], countries: [] });
    for (let index = 0; index < head; index += 1) {
      current = applyTripCommand(current, history[index]);
    }
    model = ensureDefaultCountry(current);
    modelDirty = false;
    return model;
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      normalized.push(line);
      skippedLines += 1;
      continue;
    }

    let parsed: ParsedCommand;
    try {
      parsed = parseCommand(trimmed);
    } catch (error) {
      warnings.push(
        `Skipping unparsable line: ${trimmed}${error instanceof Error ? ` (${error.message})` : ""}`
      );
      normalized.push(line);
      skippedLines += 1;
      continue;
    }

    let context: CanonicalCommandContext | undefined;

    if (parsed.type === "undo") {
      head = Math.max(0, head - parsed.count);
      modelDirty = true;
    } else if (parsed.type === "redo") {
      head = Math.min(history.length, head + parsed.count);
      modelDirty = true;
    } else {
      if (head < history.length) {
        history.splice(head);
        modelDirty = true;
      }
      if (parsed.type === "delete") {
        const snapshot = ensureModel().activities.find((activity) => activity.uid === parsed.uid);
        if (snapshot) {
          context = { deletedActivity: { ...snapshot } };
        }
      }
      history.push(parsed);
      head = history.length;
      modelDirty = true;
    }

    const canonical = formatCanonicalCommand(parsed, context);
    normalized.push(canonical);
    normalizedLines += 1;
  }

  const tempPath = `${filePath}.tmp`;
  await fs.outputFile(tempPath, normalized.join("\n"), "utf8");

  return {
    filePath,
    tempPath,
    normalizedLines,
    skippedLines,
    warnings
  };
}
