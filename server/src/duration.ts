import type { Activity, TripModel } from "./types.js";

export function decorateModelWithDurations(model: TripModel): TripModel {
  if (!model?.activities?.length) {
    return model;
  }

  let mutated = false;
  const activities = model.activities.map((activity) => {
    const decorated = decorateActivityDuration(activity);
    if (decorated !== activity) {
      mutated = true;
    }
    return decorated;
  });

  return mutated ? { ...model, activities } : model;
}

export function decorateActivityDuration(activity: Activity): Activity {
  if (!activity) {
    return activity;
  }

  const normalized = normalizeDurationText(activity.duration);
  if (normalized && normalized !== activity.duration) {
    return { ...activity, duration: normalized };
  }

  if (normalized) {
    return activity;
  }

  const fallback = convertMinutesToDurationText(activity.durationMinutes);
  if (fallback && fallback !== activity.duration) {
    return { ...activity, duration: fallback };
  }

  return activity;
}

const DURATION_TEXT_PATTERN = /^(\d+(?:\.\d+)?)\s*(days?|day|hours?|hour|hrs?|minutes?|minute|mins?|min)$/i;

export function normalizeDurationText(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(DURATION_TEXT_PATTERN);
  if (!match) {
    return trimmed;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const unit = normalizeDurationUnit(match[2]);
  return `${formatDurationAmount(amount)} ${pluralizeDurationUnit(unit, amount)}`;
}

function normalizeDurationUnit(unit: string): "day" | "hour" | "min" {
  const lower = unit.toLowerCase();
  if (lower.startsWith("day")) {
    return "day";
  }
  if (lower.startsWith("hour") || lower.startsWith("hr")) {
    return "hour";
  }
  return "min";
}

function formatDurationAmount(amount: number): string {
  if (Number.isInteger(amount)) {
    return amount.toString();
  }
  return Number(amount.toFixed(1)).toString();
}

function pluralizeDurationUnit(unit: "day" | "hour" | "min", amount: number): string {
  const isSingular = Math.abs(amount - 1) < 1e-9;
  switch (unit) {
    case "day":
      return isSingular ? "day" : "days";
    case "hour":
      return isSingular ? "hour" : "hours";
    default:
      return isSingular ? "min" : "mins";
  }
}

export function convertMinutesToDurationText(value?: number | null): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  if (value % 1440 === 0) {
    const days = value / 1440;
    return `${days} ${pluralizeDurationUnit("day", days)}`;
  }
  if (value >= 60 && value % 60 === 0) {
    const hours = value / 60;
    return `${hours} ${pluralizeDurationUnit("hour", hours)}`;
  }
  if (value >= 60) {
    const hours = Number((value / 60).toFixed(1));
    return `${formatDurationAmount(hours)} ${pluralizeDurationUnit("hour", hours)}`;
  }
  return `${value} ${pluralizeDurationUnit("min", value)}`;
}
