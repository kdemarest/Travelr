/**
 * ClientDataCache - Client-side cache of server-provided data.
 * 
 * When the server includes `clientDataCache` in a response, the client
 * completely replaces its local cache with what was sent.
 * 
 * Usage:
 *   import { clientDataCache } from "./client-data-cache";
 *   
 *   // Access cached data
 *   const trips = clientDataCache.get("trips") as string[];
 *   
 *   // Update from server response
 *   if (response.clientDataCache) {
 *     clientDataCache.update(response.clientDataCache);
 *   }
 */

export type ClientDataCacheData = Record<string, unknown>;

class ClientDataCacheImpl {
  private data: ClientDataCacheData = {};

  /**
   * Get a value from the cache.
   */
  get<T = unknown>(key: string): T | undefined {
    return this.data[key] as T | undefined;
  }

  /**
   * Check if a key exists in the cache.
   */
  has(key: string): boolean {
    return key in this.data;
  }

  /**
   * Get all cached data (for debugging or iteration).
   */
  getAll(): ClientDataCacheData {
    return { ...this.data };
  }

  /**
   * Merge new data from the server into the cache.
   * Only keys present in newData are updated; existing keys not in newData are preserved.
   */
  update(newData: ClientDataCacheData): void {
//    console.log("[clientDataCache.update] called with:", newData);
//    console.log("[clientDataCache.update] current data before update:", this.data);
    if (!newData || Object.keys(newData).length === 0) {
      console.log("[clientDataCache.update] SKIPPING - empty or missing newData");
      return;
    }
    // Merge: only update keys that are present in newData
    this.data = { ...this.data, ...newData };
//    console.log("[clientDataCache.update] Merged with keys:", Object.keys(newData));
//    console.log("[clientDataCache.update] modelList is now:", this.data.modelList);
  }

  /**
   * Clear the cache (e.g., on logout).
   */
  clear(): void {
    this.data = {};
  }
}

// Singleton instance
export const clientDataCache = new ClientDataCacheImpl();
