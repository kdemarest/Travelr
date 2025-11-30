import fs from "fs-extra";
import path from "node:path";
import { parseCommand, ParsedCommand } from "./command.js";
import { applyTripCommand } from "./reducer.js";
import { TripModel } from "./types.js";
import { ensureDefaultCountry } from "./country-defaults.js";

export class TripDocService {
  constructor(private readonly dataDir: string) {}

  private getJournalPath(tripName: string) {
    return path.join(this.dataDir, `${tripName}.travlrjournal`);
  }

  async listTrips(): Promise<string[]> {
    const entries = await fs.readdir(this.dataDir);
    return entries
      .filter((entry) => entry.endsWith(".travlrjournal"))
      .map((entry) => path.basename(entry, ".travlrjournal"))
      .sort((a, b) => a.localeCompare(b));
  }

  async rebuildModel(tripName: string): Promise<TripModel> {
    const baseModel: TripModel = ensureDefaultCountry({ tripName, tripId: tripName, activities: [], countries: [] });
    const entries = await this.readJournalEntries(tripName);
    if (entries.length === 0) {
      return baseModel;
    }
    const timeline = computeJournalTimeline(entries);
    const activeEntries = timeline.activeIndexes.map((entryIndex) => entries[entryIndex]);
    const reduced = activeEntries.reduce((model, entry) => applyTripCommand(model, entry.command), baseModel);
    return ensureDefaultCountry(reduced);
  }

  async applyCommand(tripName: string, command: ParsedCommand): Promise<TripModel> {
    if (command.type === "newtrip") {
      return ensureDefaultCountry({ tripName: command.tripId, tripId: command.tripId, activities: [], countries: [] });
    }
    return this.rebuildModel(tripName);
  }

  async getExistingModel(tripName: string): Promise<TripModel | null> {
    const journalPath = this.getJournalPath(tripName);
    if (!(await fs.pathExists(journalPath))) {
      return null;
    }
    return this.rebuildModel(tripName);
  }

  async getJournalTimeline(tripName: string): Promise<JournalTimeline> {
    const entries = await this.readJournalEntries(tripName);
    return computeJournalTimeline(entries);
  }

  async getJournalEntries(tripName: string): Promise<JournalEntry[]> {
    return this.readJournalEntries(tripName);
  }

  private async readJournalEntries(tripName: string): Promise<JournalEntry[]> {
    const journalPath = this.getJournalPath(tripName);
    if (!(await fs.pathExists(journalPath))) {
      return [];
    }
    const contents = await fs.readFile(journalPath, "utf8");
    return contents
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line, index) => ({ lineNumber: index + 1, command: parseCommand(line) }));
  }
}

export interface JournalEntry {
  lineNumber: number;
  command: ParsedCommand;
}

export interface JournalTimeline {
  activeIndexes: number[];
  orderedIndexes: number[];
  head: number;
  total: number;
}

export function computeJournalTimeline(entries: JournalEntry[]): JournalTimeline {
  const order: number[] = [];
  let head = 0;

  entries.forEach((entry, index) => {
    switch (entry.command.type) {
      case "undo": {
        const steps = entry.command.count;
        head = Math.max(0, head - steps);
        break;
      }
      case "redo": {
        const steps = entry.command.count;
        head = Math.min(order.length, head + steps);
        break;
      }
      default: {
        if (head < order.length) {
          order.splice(head);
        }
        order.push(index);
        head = order.length;
        break;
      }
    }
  });

  const orderedIndexes = order.slice();
  const activeIndexes = head === 0 ? [] : orderedIndexes.slice(0, head);
  return { activeIndexes, orderedIndexes, head, total: orderedIndexes.length };
}

export function resolveActiveJournalEntries(entries: JournalEntry[]): JournalEntry[] {
  const timeline = computeJournalTimeline(entries);
  if (timeline.activeIndexes.length === 0) {
    return [];
  }
  return timeline.activeIndexes.map((entryIndex) => entries[entryIndex]);
}
