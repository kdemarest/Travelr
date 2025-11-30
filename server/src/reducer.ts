import { ParsedCommand } from "./command.js";
import { TripModel } from "./types.js";
import { generateUid } from "./uid.js";
import { findIsoCodes } from "./iso-codes.js";
import { ensureDefaultCountry } from "./country-defaults.js";

function addDays(dateStr: string, days: number): string {
  const date = new Date(dateStr + "T00:00:00");
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function getTodayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Normalize an activity after changes:
 * - When status becomes "booked", set bookingDate if not already set
 */
function normalizeActivity(
  original: Record<string, unknown>,
  updated: Record<string, unknown>
): Record<string, unknown> {
  const result = { ...updated };
  
  // When status changes to "booked", ensure bookingDate is set
  const wasBooked = original.status === "booked" || original.status === "completed";
  const isNowBooked = result.status === "booked" || result.status === "completed";
  
  if (!wasBooked && isNowBooked && !result.bookingDate) {
    result.bookingDate = getTodayDate();
  }
  
  return result;
}

export function applyTripCommand(model: TripModel, command: ParsedCommand): TripModel {
  switch (command.type) {
    case "newtrip":
      const blankTripModel = { tripName: command.tripId, tripId: command.tripId, activities: [], countries: [] };
	  return ensureDefaultCountry(blankTripModel);
    case "add": {
      const activityUid = command.uid ?? generateUid();
      const activity = {
        uid: activityUid,
        activityType: command.activityType,
        ...command.fields
      };
      return {
        ...model,
        activities: [...model.activities, activity]
      };
    }
    case "edit": {
      const index = model.activities.findIndex((activity) => activity.uid === command.uid);
      if (index === -1) {
        return model;
      }
      const original = model.activities[index];
      const merged = { ...original, ...command.changes };
      const updated = normalizeActivity(original, merged);
      const activities = [...model.activities];
      activities[index] = updated;
      return { ...model, activities };
    }
    case "delete": {
      const activities = model.activities.filter((activity) => activity.uid !== command.uid);
      if (activities.length === model.activities.length) {
        return model;
      }
      return { ...model, activities };
    }
    case "moveday": {
      // Move all activities from one date to another
      const hasMatches = model.activities.some((activity) => activity.date === command.from);
      if (!hasMatches) {
        return model;
      }
      const activities = model.activities.map((activity) =>
        activity.date === command.from ? { ...activity, date: command.to } : activity
      );
      return { ...model, activities };
    }
    case "insertday": {
      // Insert a blank day after the specified date, pushing all subsequent activities forward
      const afterDate = command.after;
      const activities = model.activities.map((activity) => {
        if (activity.date && activity.date > afterDate) {
          const newDate = addDays(activity.date, 1);
          return { ...activity, date: newDate };
        }
        return activity;
      });
      return { ...model, activities };
    }
    case "removeday": {
      // Remove a day, pulling all subsequent activities backward
      const removeDate = command.date;
      const activities = model.activities.map((activity) => {
        if (activity.date && activity.date > removeDate) {
          const newDate = addDays(activity.date, -1);
          return { ...activity, date: newDate };
        }
        return activity;
      });
      return { ...model, activities };
    }
    case "addcountry": {
      const normalizedCountry = command.countryName.trim();
      const lookup = !command.countryAlpha2 || !command.currencyAlpha3 ? findIsoCodes(normalizedCountry) : null;
      const resolvedcountryAlpha2 = (command.countryAlpha2 ?? lookup?.countryAlpha2 ?? "").trim().toUpperCase();
      const resolvedcurrencyAlpha3 = (command.currencyAlpha3 ?? lookup?.currencyAlpha3 ?? "").trim().toUpperCase();
      if (!resolvedcountryAlpha2 || !resolvedcurrencyAlpha3) {
        return model;
      }

      const existingCountries = model.countries ?? [];
      const countries = [...existingCountries];
      const nextEntry = {
        country: normalizedCountry,
        countryAlpha2: resolvedcountryAlpha2,
        currencyAlpha3: resolvedcurrencyAlpha3,
        exchangeRateToUSD: command.exchangeRateToUSD ?? 1,
        id: command.id ?? generateUid()
      };

      const normalizedTarget = normalizedCountry.toLowerCase();
      const index = countries.findIndex((entry) => {
        if (command.id && entry.id === command.id) {
          return true;
        }
        if (entry.countryAlpha2 && entry.countryAlpha2 === nextEntry.countryAlpha2) {
          return true;
        }
        return (entry.country ?? "").trim().toLowerCase() === normalizedTarget;
      });

      if (index >= 0) {
        if (
          countries[index].country === nextEntry.country &&
          countries[index].countryAlpha2 === nextEntry.countryAlpha2 &&
          countries[index].currencyAlpha3 === nextEntry.currencyAlpha3 &&
          countries[index].exchangeRateToUSD === nextEntry.exchangeRateToUSD &&
          countries[index].id === nextEntry.id
        ) {
          return model;
        }
        countries[index] = nextEntry;
      } else {
        countries.push(nextEntry);
      }
      return { ...model, countries };
    }
    case "undo":
    case "redo":
    case "help":
    case "trip":
      return model;
    default:
      return model;
  }
}
