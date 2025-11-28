import type { Activity, PlanLine } from "../types";
import { addLocalDays, formatCanonicalDate, parseFlexibleDate, startOfLocalDay } from "../datetime";

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function buildPlanLines(modelActivities: Activity[]): PlanLine[] {
  if (!modelActivities || modelActivities.length === 0) {
    return [];
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

  const datedLines = fillMissingDates(datedEntries);

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

function fillMissingDates(entries: Array<{ dateKey: string; date: Date; activities: Activity[] }>): PlanLine[] {
  if (!entries.length) {
    return [];
  }

  const entryMap = new Map(entries.map((entry) => [entry.dateKey, entry]));
  const lines: PlanLine[] = [];
  let cursor = startOfLocalDay(entries[0].date);
  const lastDate = startOfLocalDay(entries[entries.length - 1].date);

  while (cursor.getTime() <= lastDate.getTime()) {
    const dateKey = formatCanonicalDate(cursor);
    const existing = entryMap.get(dateKey);
    if (existing) {
      const primaryUid = pickPrimaryActivityUid(existing.activities);
      lines.push({
        kind: "dated",
        date: dateKey,
        displayDate: formatDisplayDate(existing.date),
        fullDisplayDate: formatFullDisplayDate(existing.date),
        notation: buildNotation(existing.activities),
        activities: [...existing.activities],
        primaryActivityUid: primaryUid
      });
    } else {
      lines.push({
        kind: "dated",
        date: dateKey,
        displayDate: formatDisplayDate(cursor),
        fullDisplayDate: formatFullDisplayDate(cursor),
        notation: "",
        activities: [],
        primaryActivityUid: null
      });
    }
    cursor = addLocalDays(cursor, 1);
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
