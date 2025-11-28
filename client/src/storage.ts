const LAST_TRIP_STORAGE_KEY = "travelr:lastTripId";
const FOCUSED_DATE_KEY_PREFIX = "travelr:focusedDate:";
const FOCUSED_ACTIVITY_KEY_PREFIX = "travelr:focusedActivity:";

export function loadLastTripId(): string | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(LAST_TRIP_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function saveLastTripId(tripId: string) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(LAST_TRIP_STORAGE_KEY, tripId);
  } catch {
    // Ignore storage failures.
  }
}

export function loadFocusedDate(tripId: string | null): string | null {
  if (!tripId || typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(getFocusedDateStorageKey(tripId));
  } catch {
    return null;
  }
}

export function saveFocusedDate(tripId: string, date: string | null) {
  if (!tripId || typeof window === "undefined") {
    return;
  }
  if (!date) {
    try {
      window.localStorage.removeItem(getFocusedDateStorageKey(tripId));
    } catch {
      // Ignore storage failures.
    }
    return;
  }
  try {
    window.localStorage.setItem(getFocusedDateStorageKey(tripId), date);
  } catch {
    // Ignore storage failures.
  }
}

function getFocusedDateStorageKey(tripId: string) {
  return `${FOCUSED_DATE_KEY_PREFIX}${tripId}`;
}

export function loadFocusedActivityUid(tripId: string | null): string | null {
  if (!tripId || typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage.getItem(getFocusedActivityStorageKey(tripId));
  } catch {
    return null;
  }
}

export function saveFocusedActivityUid(tripId: string, uid: string) {
  if (!tripId || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.setItem(getFocusedActivityStorageKey(tripId), uid);
  } catch {
    // Ignore storage failures.
  }
}

export function clearFocusedActivityUid(tripId: string) {
  if (!tripId || typeof window === "undefined") {
    return;
  }
  try {
    window.localStorage.removeItem(getFocusedActivityStorageKey(tripId));
  } catch {
    // Ignore storage failures.
  }
}

function getFocusedActivityStorageKey(tripId: string) {
  const normalized = tripId.trim();
  return `${FOCUSED_ACTIVITY_KEY_PREFIX}${normalized}`;
}
