const LAST_TRIP_STORAGE_KEY = "travelr:lastTripId";
const SELECTED_DATE_KEY_PREFIX = "travelr:selectedDate:";
const SELECTED_ACTIVITY_KEY_PREFIX = "travelr:selectedActivity:";

export function readLastTripId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(LAST_TRIP_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function persistLastTripId(tripId: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LAST_TRIP_STORAGE_KEY, tripId);
  } catch {
    // Ignore storage failures.
  }
}

export function readSelectedDate(tripId: string | null): string | null {
  if (!tripId || typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(getSelectedDateKey(tripId));
  } catch {
    return null;
  }
}

export function persistSelectedDate(tripId: string, dateKey: string) {
  if (!tripId || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(getSelectedDateKey(tripId), dateKey);
  } catch {
    // Ignore storage failures.
  }
}

export function clearSelectedDate(tripId: string) {
  if (!tripId || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(getSelectedDateKey(tripId));
  } catch {
    // Ignore storage failures.
  }
}

function getSelectedDateKey(tripId: string) {
  return `${SELECTED_DATE_KEY_PREFIX}${tripId}`;
}

export function readSelectedActivityUid(tripId: string | null): string | null {
  if (!tripId || typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(getSelectedActivityKey(tripId));
  } catch {
    return null;
  }
}

export function persistSelectedActivityUid(tripId: string, uid: string) {
  if (!tripId || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(getSelectedActivityKey(tripId), uid);
  } catch {
    // Ignore storage failures.
  }
}

export function clearSelectedActivityUid(tripId: string) {
  if (!tripId || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(getSelectedActivityKey(tripId));
  } catch {
    // Ignore storage failures.
  }
}

function getSelectedActivityKey(tripId: string) {
  const normalized = tripId.trim();
  return `${SELECTED_ACTIVITY_KEY_PREFIX}${normalized}`;
}
