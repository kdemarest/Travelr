import type { LazyFile } from "./lazy-file.js";
import type { UserPreferences } from "./user-preferences.js";
import { ensureUserPrefsFile } from "./user-preferences.js";
import { ClientDataCache } from "./client-data-cache.js";

/**
 * Authenticated user info.
 */
export class User {
  userId: string;
  isAdmin: boolean;
  clientDataCache: ClientDataCache;

  constructor(userId: string, isAdmin: boolean, clientDataCache: ClientDataCache) {
    this.userId = userId;
    this.isAdmin = isAdmin;
    this.clientDataCache = clientDataCache;
  }

  async getPrefsFile(): Promise<LazyFile<UserPreferences>> {
    return ensureUserPrefsFile(this.userId);
  }
}
