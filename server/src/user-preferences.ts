/**
 * Per-user preferences with LazyFile caching.
 * 
 * Each user gets their own prefs file: dataUserPrefs/<userId>-prefs.json
 * On first login, the default-prefs.json is copied to create their file.
 * 
 * The LazyFile is loaded during authentication and attached to the User object.
 */

import { LazyFile } from "./lazy-file.js";
import { getStorageFor, getStorageLocal } from "./storage.js";

const PREFS_DIR = "dataUserPrefs";
const DEFAULT_PREFS_KEY = `${PREFS_DIR}/default-prefs.json`;

export type UserPreferences = Record<string, unknown>;

// JSON helpers
const parseJson = (text: string): UserPreferences => JSON.parse(text);
const toJson = (data: UserPreferences): string => JSON.stringify(data, null, 2) + "\n";

// Cache of loaded user preference files
const userPrefsCache = new Map<string, LazyFile<UserPreferences>>();

/**
 * Get the storage key for a user's preferences file.
 */
function getUserPrefsKey(userId: string): string {
  return `${PREFS_DIR}/${userId}-prefs.json`;
}

/**
 * Load default preferences from storage.
 */
async function loadDefaultPreferences(): Promise<UserPreferences> {
  // Default prefs are always local (part of the codebase)
  const storage = getStorageLocal();
  const text = await storage.read(DEFAULT_PREFS_KEY);
  if (text) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Ensure a user's prefs file exists, copying from defaults if needed.
 * Returns the LazyFile for that user's preferences.
 * Called during authentication to attach prefs to the User object.
 */
export async function ensureUserPrefsFile(userId: string): Promise<LazyFile<UserPreferences>> {
  // Check cache first
  const cached = userPrefsCache.get(userId);
  if (cached) {
    return cached;
  }

  const userPrefsKey = getUserPrefsKey(userId);
  const storage = getStorageFor(userPrefsKey);

  // If user's prefs file doesn't exist, copy from defaults
  if (!await storage.exists(userPrefsKey)) {
    const defaults = await loadDefaultPreferences();
    await storage.write(userPrefsKey, toJson(defaults));
    console.log(`[user-preferences] Created prefs file for user: ${userId}`);
  }

  // Create and load the LazyFile
  const lazyFile = new LazyFile<UserPreferences>(
    userPrefsKey,
    storage,
    {},
    parseJson,
    toJson
  );
  await lazyFile.load();

  // Cache it
  userPrefsCache.set(userId, lazyFile);

  return lazyFile;
}

/**
 * Flush all pending user preference writes.
 * Call on shutdown.
 */
export async function flushUserPreferences(): Promise<void> {
  for (const [userId, lazyFile] of userPrefsCache) {
    if (lazyFile.hasPendingWrite()) {
      console.log(`[user-preferences] Flushing prefs for user: ${userId}`);
      await lazyFile.flush();
    }
  }
}
