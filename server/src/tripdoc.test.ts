import { describe, expect, it } from "vitest";
import { applyTripCommand } from "./reducer.js";
import type { TripModel } from "./types.js";
import type { JournalEntry } from "./tripdoc.js";
import { resolveActiveJournalEntries } from "./tripdoc.js";

describe("resolveActiveJournalEntries", () => {
  it("handles undo bursts with intervening commands", () => {
    const entries: JournalEntry[] = [
      addEntry(1, "cmd1"),
      addEntry(2, "cmd2"),
      addEntry(3, "cmd3"),
      addEntry(4, "cmd4"),
      undoEntry(5),
      addEntry(6, "cmd5"),
      undoEntry(7),
      undoEntry(8),
      addEntry(9, "cmd6")
    ];

    const active = resolveActiveJournalEntries(entries);
    const model = replay(active);

    expect(model.activities.map((activity) => activity.uid)).toEqual(["cmd1", "cmd2", "cmd6"]);
  });

  it("supports redo without truncating history", () => {
    const entries: JournalEntry[] = [
      addEntry(1, "cmd1"),
      addEntry(2, "cmd2"),
      addEntry(3, "cmd3"),
      undoEntry(4, 2),
      redoEntry(5)
    ];

    const active = resolveActiveJournalEntries(entries);
    const model = replay(active);

    expect(model.activities.map((activity) => activity.uid)).toEqual(["cmd1", "cmd2"]);
  });

  it("clears redo history when a new command arrives", () => {
    const entries: JournalEntry[] = [
      addEntry(1, "cmd1"),
      addEntry(2, "cmd2"),
      undoEntry(3),
      addEntry(4, "cmd3"),
      redoEntry(5)
    ];

    const active = resolveActiveJournalEntries(entries);
    const model = replay(active);

    expect(model.activities.map((activity) => activity.uid)).toEqual(["cmd1", "cmd3"]);
  });
});

function addEntry(lineNumber: number, uid: string): JournalEntry {
  return {
    lineNumber,
    command: {
      type: "add",
      activityType: "visit",
      fields: { name: uid },
      uid
    }
  };
}

function undoEntry(lineNumber: number, count = 1): JournalEntry {
  return {
    lineNumber,
    command: {
      type: "undo",
      count
    }
  };
}

function redoEntry(lineNumber: number, count = 1): JournalEntry {
  return {
    lineNumber,
    command: {
      type: "redo",
      count
    }
  };
}

function replay(entries: JournalEntry[]): TripModel {
  return entries.reduce<TripModel>(
    (model, entry) => applyTripCommand(model, entry.command),
    { tripName: "test", tripId: "test", activities: [] }
  );
}
