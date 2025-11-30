import { describe, expect, it } from "vitest";
import { applyTripCommand } from "./reducer.js";
import type { TripModel } from "./types.js";
import type { JournalEntry } from "./tripdoc.js";
import { resolveActiveJournalEntries } from "./tripdoc.js";
import { ensureDefaultCountry } from "./country-defaults.js";

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
    ensureDefaultCountry({ tripName: "test", tripId: "test", activities: [], countries: [] })
  );
}

describe("applyTripCommand addcountry", () => {
  it("adds a country entry with provided ISO codes", () => {
    const model: TripModel = ensureDefaultCountry({ tripName: "test", tripId: "test", activities: [], countries: [] });
    const result = applyTripCommand(model, {
      type: "addcountry",
      countryName: "Japan",
      countryAlpha2: "JP",
      currencyAlpha3: "JPY",
      id: "countryJapan"
    });

    const japan = result.countries?.find((entry) => entry.countryAlpha2 === "JP");
    expect(japan).toBeTruthy();
    expect(japan).toMatchObject({
      country: "Japan",
      countryAlpha2: "JP",
      currencyAlpha3: "JPY",
      exchangeRateToUSD: 1,
      id: "countryJapan"
    });
  });

  it("derives ISO codes when they are omitted", () => {
    const model: TripModel = ensureDefaultCountry({ tripName: "test", tripId: "test", activities: [], countries: [] });
    const result = applyTripCommand(model, {
      type: "addcountry",
      countryName: "Japan"
    });

    const japan = result.countries?.find((entry) => entry.countryAlpha2 === "JP");
    expect(japan).toBeTruthy();
    expect(japan).toMatchObject({
      countryAlpha2: "JP",
      currencyAlpha3: "JPY",
      exchangeRateToUSD: 1
    });
  });

  it("updates an existing entry instead of duplicating", () => {
    const baseModel: TripModel = ensureDefaultCountry({
      tripName: "test",
      tripId: "test",
      activities: [],
      countries: [
        {
          country: "Japan",
          countryAlpha2: "JP",
          currencyAlpha3: "JPY",
          exchangeRateToUSD: 1,
          id: "countryJapan"
        }
      ]
    });

    const result = applyTripCommand(baseModel, {
      type: "addcountry",
      countryName: "Japan",
      countryAlpha2: "JP",
      currencyAlpha3: "JPY",
      id: "countryJapan"
    });

    const japanEntries = result.countries?.filter((entry) => entry.countryAlpha2 === "JP");
    expect(japanEntries).toHaveLength(1);
    expect(result.countries?.find((entry) => entry.countryAlpha2 === "JP")).toMatchObject({
      country: "Japan",
      currencyAlpha3: "JPY",
      exchangeRateToUSD: 1,
      id: "countryJapan"
    });
  });
});
