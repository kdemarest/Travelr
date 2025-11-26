const MINUTES_IN_DAY = 24 * 60;
const MINUTES_IN_HALF_DAY = 12 * 60;

export function normalizeUserTime(input: string): string | null {
  if (!input) {
    return null;
  }

  let value = input.trim().toLowerCase();
  if (!value) {
    return null;
  }

  if (value === "noon") {
    return "12:00";
  }
  if (value === "midnight") {
    return "00:00";
  }

  const ampmMatch = value.match(/\s*(a|am|p|pm)$/);
  if (ampmMatch) {
    const suffix = ampmMatch[1];
    const timePortion = value.slice(0, value.length - ampmMatch[0].length).trim();
    const parsed = parseHourMinute(timePortion);
    if (!parsed) {
      return null;
    }
    const total = convertAmPm(parsed.hours, parsed.minutes, suffix);
    return total === null ? null : minutesToTime(total);
  }

  value = value.replace(/\s+/g, "");
  if (value.endsWith("h")) {
    value = value.slice(0, -1);
  }

  const parsed = parseHourMinute(value);
  if (!parsed) {
    return null;
  }

  if (!isValidTime(parsed.hours, parsed.minutes)) {
    return null;
  }

  return minutesToTime(parsed.hours * 60 + parsed.minutes);
}

function parseHourMinute(value: string): { hours: number; minutes: number } | null {
  if (!value) {
    return { hours: 0, minutes: 0 };
  }

  if (value.includes(":")) {
    const [rawHours, rawMinutes] = value.split(":");
    const hours = Number(rawHours);
    const minutes = Number(rawMinutes ?? "0");
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return null;
    }
    return { hours, minutes };
  }

  if (/^\d{3,4}$/.test(value)) {
    const padded = value.padStart(4, "0");
    const hours = Number(padded.slice(0, padded.length - 2));
    const minutes = Number(padded.slice(-2));
    if (Number.isNaN(hours) || Number.isNaN(minutes)) {
      return null;
    }
    return { hours, minutes };
  }

  if (/^\d{1,2}$/.test(value)) {
    const hours = Number(value);
    if (Number.isNaN(hours)) {
      return null;
    }
    return { hours, minutes: 0 };
  }

  return null;
}

function convertAmPm(hours: number, minutes: number, suffix: string): number | null {
  if (!isValidTime(hours % 12, minutes)) {
    return null;
  }
  const base = (hours % 12) * 60 + minutes;
  const total = suffix.startsWith("p") ? base + MINUTES_IN_HALF_DAY : base;
  return total % MINUTES_IN_DAY;
}

function isValidTime(hours: number, minutes: number): boolean {
  return hours >= 0 && hours < 24 && minutes >= 0 && minutes < 60;
}

function minutesToTime(totalMinutes: number): string {
  const hrs = Math.floor(totalMinutes / 60)
    .toString()
    .padStart(2, "0");
  const mins = (totalMinutes % 60).toString().padStart(2, "0");
  return `${hrs}:${mins}`;
}
