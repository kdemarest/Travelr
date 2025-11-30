import type { Activity, DaySummary, PlanLine } from "../types";
import { addLocalDays, formatCanonicalDate, parseFlexibleDate, startOfLocalDay } from "../datetime";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * Derive indicator fields from a DaySummary for the PlanLine
 */
function deriveIndicators(summary: DaySummary | undefined, activities: Activity[]): {
  flightCount: number;
  flightBooked: boolean;
  hasRentalCar: boolean;
  rentalCarBooked: boolean;
  lodgingStatus: "none" | "unbooked" | "booked" | "multiple";
  lodgingCity?: string;
  mealCount: number;
  mealsNeedingReservation: number;
  hasDateMismatchIssue: boolean;
  issueNoTransportToLodging: boolean;
  issueNoTransportToFlight: boolean;
} {
  if (summary) {
    // Derive from pre-computed summary
    let lodgingStatus: "none" | "unbooked" | "booked" | "multiple" = "none";
    if (summary.issueMoreThanOneLodging) {
      lodgingStatus = "multiple";
    } else if (summary.issueNoLodging) {
      lodgingStatus = "none";
    } else if (summary.lodgingBooked) {
      lodgingStatus = "booked";
    } else if (summary.hasPotentialLodging) {
      lodgingStatus = "unbooked";
    }

    return {
      flightCount: summary.flightCount,
      flightBooked: summary.flightBooked,
      hasRentalCar: summary.hasRentalCar,
      rentalCarBooked: summary.rentalCarBooked,
      lodgingStatus,
      lodgingCity: summary.lodgingCity,
      mealCount: summary.mealsDiningOut,
      mealsNeedingReservation: summary.mealsNeedingReservation,
      hasDateMismatchIssue: Boolean(summary.issueActivitiesWithMismatchedBookingDates),
      issueNoTransportToLodging: summary.issueNoTransportToLodging ?? false,
      issueNoTransportToFlight: summary.issueNoTransportToFlight ?? false,
    };
  }

  // Fallback: derive from activities directly (no spanning info available)
  const flights = activities.filter(a => a.activityType === "flight");
  const rentalCars = activities.filter(a => a.activityType === "rentalCar");
  const lodgings = activities.filter(a => a.activityType === "lodging");
  const meals = activities.filter(a => a.activityType === "meal");

  let lodgingStatus: "none" | "unbooked" | "booked" | "multiple" = "none";
  if (lodgings.length > 1) {
    lodgingStatus = "multiple";
  } else if (lodgings.length === 1) {
    const status = lodgings[0].status;
    lodgingStatus = (status === "booked" || status === "completed") ? "booked" : "unbooked";
  }

  // Try to get city from first lodging activity
  const lodgingCity = lodgings.length > 0 ? (lodgings[0] as Record<string, unknown>).city as string | undefined : undefined;

  const mealsNeedingRes = meals.filter(m => {
    const needsRes = (m as Record<string, unknown>).reservationNeeded;
    const status = m.status;
    return needsRes === true && status !== "booked" && status !== "completed";
  }).length;

  return {
    flightCount: flights.length,
    flightBooked: flights.some(a => a.status === "booked" || a.status === "completed"),
    hasRentalCar: rentalCars.length > 0,
    rentalCarBooked: rentalCars.some(a => a.status === "booked" || a.status === "completed"),
    lodgingStatus,
    lodgingCity,
    mealCount: meals.length,
    mealsNeedingReservation: mealsNeedingRes,
    hasDateMismatchIssue: false,
    issueNoTransportToLodging: false,
    issueNoTransportToFlight: false,
  };
}

export function buildPlanLines(
  modelActivities: Activity[],
  markedActivities?: ReadonlySet<string>,
  markedDates?: ReadonlySet<string>,
  daySummaries?: DaySummary[]
): PlanLine[] {
  if (!modelActivities || modelActivities.length === 0) {
    return [];
  }

  // Build a lookup map for day summaries
  const summaryByDate = new Map<string, DaySummary>();
  if (daySummaries) {
    for (const summary of daySummaries) {
      summaryByDate.set(summary.date, summary);
    }
  }

  const undated: PlanLine[] = [];
  const dated = new Map<string, { activities: Activity[]; date: Date }>();

  for (const activity of modelActivities) {
    if (!activity) {
      continue;
    }

    const label = describeActivity(activity);
    if (!label) {
      continue;
    }

    const rawDate = (activity.date ?? "").trim();
    const parsedDate = parseFlexibleDate(rawDate);
    if (!parsedDate) {
      undated.push({ kind: "undated", label });
      continue;
    }

    const canonicalKey = formatCanonicalDate(parsedDate);
    const group = dated.get(canonicalKey);
    if (group) {
      group.activities.push(activity);
    } else {
      dated.set(canonicalKey, {
        activities: [activity],
        date: parsedDate
      });
    }
  }

  const datedEntries = Array.from(dated.entries())
    .map(([dateKey, info]) => ({ dateKey, date: startOfLocalDay(info.date), activities: info.activities }))
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const datedLines = fillMissingDates(datedEntries, markedActivities, markedDates, summaryByDate);

  return [...undated, ...datedLines];
}

export function describeActivity(activity: Activity): string {
  const name = activity.name?.trim();
  if (name) {
    return name;
  }

  const userNotes = activity.notesUser?.trim();
  if (userNotes) {
    return userNotes;
  }

  const type = activity.activityType?.trim();
  if (type) {
    return type;
  }

  return activity.uid;
}

export function buildNotation(activities: Activity[]): string {
  if (!activities.length) {
    return "";
  }

  const importantLabels = activities
    .filter((activity) => isImportant(activity))
    .map((activity) => describeActivity(activity))
    .filter((label) => label.length > 0);

  if (importantLabels.length > 0) {
    return importantLabels.join(", ");
  }

  return describeActivity(activities[0]);
}

function formatDisplayDate(date: Date): string {
  const weekday = WEEKDAYS[date.getDay()] ?? "";
  const month = MONTHS[date.getMonth()] ?? "";
  const day = date.getDate().toString().padStart(2, " ");
  return `${weekday} ${month} ${day}`;
}

function formatFullDisplayDate(date: Date): string {
  const weekday = WEEKDAYS[date.getDay()] ?? "";
  const month = MONTHS[date.getMonth()] ?? "";
  const day = date.getDate().toString().padStart(2, " ").trimStart();
  return `${weekday}, ${month} ${day}, ${date.getFullYear()}`;
}

function fillMissingDates(
  entries: Array<{ dateKey: string; date: Date; activities: Activity[] }>,
  markedActivities?: ReadonlySet<string>,
  markedDates?: ReadonlySet<string>,
  summaryByDate?: Map<string, DaySummary>
): PlanLine[] {
  if (!entries.length && (!summaryByDate || summaryByDate.size === 0)) {
    return [];
  }

  const entryMap = new Map(entries.map((entry) => [entry.dateKey, entry]));
  const lines: Array<Extract<PlanLine, { kind: "dated" }>> = [];
  
  // Determine date range: use day summaries if available (includes span dates),
  // otherwise fall back to activity dates only
  let startDateKey: string;
  let endDateKey: string;
  
  if (summaryByDate && summaryByDate.size > 0) {
    // Day summaries are sorted and include span end dates
    const summaryDates = Array.from(summaryByDate.keys()).sort();
    startDateKey = summaryDates[0];
    endDateKey = summaryDates[summaryDates.length - 1];
  } else if (entries.length > 0) {
    startDateKey = entries[0].dateKey;
    endDateKey = entries[entries.length - 1].dateKey;
  } else {
    return [];
  }
  
  let cursor = startOfLocalDay(parseFlexibleDate(startDateKey)!);
  const lastDate = startOfLocalDay(parseFlexibleDate(endDateKey)!);

  while (cursor.getTime() <= lastDate.getTime()) {
    const dateKey = formatCanonicalDate(cursor);
    const existing = entryMap.get(dateKey);
    const summary = summaryByDate?.get(dateKey);
    
    if (existing) {
      const primaryUid = pickPrimaryActivityUid(existing.activities);
      const indicators = deriveIndicators(summary, existing.activities);
      lines.push({
        kind: "dated",
        date: dateKey,
        displayDate: formatDisplayDate(existing.date),
        fullDisplayDate: formatFullDisplayDate(existing.date),
        notation: buildNotation(existing.activities),
        activities: [...existing.activities],
        primaryActivityUid: primaryUid,
        markedCount: countMarked(existing.activities, markedActivities),
        isDateMarked: Boolean(markedDates?.has(dateKey)),
        ...indicators,
      });
    } else {
      const indicators = deriveIndicators(summary, []);
      lines.push({
        kind: "dated",
        date: dateKey,
        displayDate: formatDisplayDate(cursor),
        fullDisplayDate: formatFullDisplayDate(cursor),
        notation: "",
        activities: [],
        primaryActivityUid: null,
        markedCount: 0,
        isDateMarked: Boolean(markedDates?.has(dateKey)),
        ...indicators,
      });
    }
    cursor = addLocalDays(cursor, 1);
  }

  // Compute lodging transition flags by comparing adjacent days
  if (summaryByDate) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const currentSummary = summaryByDate.get(line.date);
      const prevSummary = i > 0 ? summaryByDate.get(lines[i - 1].date) : null;
      const nextSummary = i < lines.length - 1 ? summaryByDate.get(lines[i + 1].date) : null;
      
      const currentCity = currentSummary?.lodgingCity ?? null;
      const prevCity = prevSummary?.lodgingCity ?? null;
      const nextCity = nextSummary?.lodgingCity ?? null;
      
      const hasLodging = currentSummary?.hasPotentialLodging ?? false;
      
      // Lodging starts here if we have lodging and previous day has different/no lodging
      line.lodgingStartsHere = hasLodging && (prevCity !== currentCity);
      
      // Lodging ends here if we have lodging and next day has different/no lodging
      line.lodgingEndsHere = hasLodging && (nextCity !== currentCity);
    }
  }

  return lines;
}

function isImportant(activity: Activity): boolean {
  const value = activity.important;
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }
  return false;
}

function pickPrimaryActivityUid(activities: Activity[]): string | null {
  if (!activities.length) {
    return null;
  }
  const importantActivity = activities.find((activity) => isImportant(activity));
  if (importantActivity) {
    return importantActivity.uid;
  }
  return activities[0]?.uid ?? null;
}

function countMarked(activities: Activity[], markedActivities?: ReadonlySet<string>): number {
  if (!markedActivities || !activities.length) {
    return 0;
  }
  let count = 0;
  for (const activity of activities) {
    if (activity?.uid && markedActivities.has(activity.uid)) {
      count += 1;
    }
  }
  return count;
}
