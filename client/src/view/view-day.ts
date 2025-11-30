import type { Activity } from "../types";

export type DayEntry = {
  time: string;
  displayTime: string;
  label: string;
  activity: Activity | null;
  isPlaceholder: boolean;
  isMarked: boolean;
};

const START_HOUR = 0;
const END_HOUR = 23;

export function buildDayItems(
  activities: Activity[],
  describeActivity: (activity: Activity) => string,
  markedUids?: Set<string>
): DayEntry[] {
  const markedSet = markedUids ?? new Set<string>();
  const sorted = activities.map((activity, index) => {
    const sortValue = getTimeSortValue(activity.time);
    return { activity, index, sortValue };
  });

  const byHour = new Map<number, Array<{ activity: Activity; sortValue: number; index: number }>>();
  const overflow: Array<{ activity: Activity; sortValue: number | null; index: number }> = [];

  for (const entry of sorted) {
    if (entry.sortValue === null) {
      overflow.push({ activity: entry.activity, sortValue: null, index: entry.index });
      continue;
    }
    const hour = Math.floor(entry.sortValue / 60);
    if (hour < START_HOUR || hour > END_HOUR) {
      overflow.push({ activity: entry.activity, sortValue: entry.sortValue, index: entry.index });
      continue;
    }
    const bucket = byHour.get(hour);
    if (bucket) {
      bucket.push({ activity: entry.activity, sortValue: entry.sortValue, index: entry.index });
    } else {
      byHour.set(hour, [{ activity: entry.activity, sortValue: entry.sortValue, index: entry.index }]);
    }
  }

  const items: DayEntry[] = [];

  const untimedOverflow = overflow
    .filter((entry) => entry.sortValue === null)
    .sort((a, b) => a.index - b.index);

  if (untimedOverflow.length) {
    untimedOverflow.forEach((entry) => {
      const fallbackTime = "--:--";
      items.push({
        time: fallbackTime,
        displayTime: resolveDisplayTime(entry.activity, fallbackTime),
        label: describeActivity(entry.activity),
        activity: entry.activity,
        isPlaceholder: false,
        isMarked: isMarked(entry.activity, markedSet)
      });
    });
  }

  for (let hour = START_HOUR; hour <= END_HOUR; hour += 1) {
    const bucket = byHour.get(hour);
    if (!bucket || bucket.length === 0) {
      const hourLabel = formatHourLabel(hour);
      items.push({
        time: hourLabel,
        displayTime: hourLabel,
        label: "",
        activity: null,
        isPlaceholder: true,
        isMarked: false
      });
      continue;
    }
    bucket
      .sort((a, b) => (a.sortValue !== b.sortValue ? a.sortValue - b.sortValue : a.index - b.index))
      .forEach((entry) => {
        const normalizedTime = formatTimeLabel(entry.sortValue);
        items.push({
          time: normalizedTime,
          displayTime: resolveDisplayTime(entry.activity, normalizedTime),
          label: describeActivity(entry.activity),
          activity: entry.activity,
          isPlaceholder: false,
          isMarked: isMarked(entry.activity, markedSet)
        });
      });
  }

  const timedOverflow = overflow
    .filter((entry): entry is { activity: Activity; sortValue: number; index: number } => entry.sortValue !== null)
    .sort((a, b) => (a.sortValue !== b.sortValue ? a.sortValue - b.sortValue : a.index - b.index));

  if (timedOverflow.length) {
    timedOverflow.forEach((entry) => {
      const normalizedTime = formatTimeLabel(entry.sortValue);
      items.push({
        time: normalizedTime,
        displayTime: resolveDisplayTime(entry.activity, normalizedTime),
        label: describeActivity(entry.activity),
        activity: entry.activity,
        isPlaceholder: false,
        isMarked: isMarked(entry.activity, markedSet)
      });
    });
  }

  return items;
}

function isMarked(activity: Activity | null, markedSet: Set<string>): boolean {
  if (!activity?.uid) {
    return false;
  }
  return markedSet.has(activity.uid);
}

function getTimeSortValue(time?: string | null): number | null {
  if (!time) {
    return null;
  }
  const trimmed = time.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  if (Number.isNaN(hours) || Number.isNaN(minutes) || hours > 23 || minutes > 59 || hours < 0) {
    return null;
  }
  return hours * 60 + minutes;
}

function formatTimeLabel(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const minutes = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatHourLabel(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`;
}

function resolveDisplayTime(activity: Activity | null, fallback: string): string {
  if (!activity) {
    return fallback;
  }
  const raw = activity.time?.trim();
  return raw && raw.length ? raw : fallback;
}
