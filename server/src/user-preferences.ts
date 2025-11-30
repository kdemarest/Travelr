import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_PREFS_PATH = path.resolve(__dirname, "../../userprefs/default-prefs.json");
type UserPreferences = Record<string, unknown>;

let cachedPreferences: UserPreferences | null = null;
let loadPromise: Promise<UserPreferences> | null = null;

export async function getDefaultUserPreferences(): Promise<UserPreferences> {
  const preferences = await loadPreferences();
  return clonePreferences(preferences);
}

export async function setUserPreference(key: string, value: string): Promise<UserPreferences> {
  if (!key || !key.trim()) {
    throw new Error("Preference key cannot be empty.");
  }
  const preferences = await loadPreferences();
  const next: UserPreferences = { ...preferences, [key]: value };
  await writePreferences(next);
  cachedPreferences = next;
  return clonePreferences(next);
}

async function loadPreferences(): Promise<UserPreferences> {
  if (cachedPreferences) {
    return cachedPreferences;
  }
  if (!loadPromise) {
    loadPromise = readFile(DEFAULT_PREFS_PATH, "utf-8")
      .then((contents) => {
        const parsed = JSON.parse(contents) as UserPreferences;
        cachedPreferences = parsed;
        return parsed;
      })
      .catch((error) => {
        loadPromise = null;
        throw error;
      });
  }
  return loadPromise;
}

async function writePreferences(preferences: UserPreferences): Promise<void> {
  const json = `${JSON.stringify(preferences, null, 2)}\n`;
  await writeFile(DEFAULT_PREFS_PATH, json, "utf-8");
}

function clonePreferences(preferences: UserPreferences): UserPreferences {
  return JSON.parse(JSON.stringify(preferences));
}
