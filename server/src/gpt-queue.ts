/**
 * GPT Queue - manages async GPT responses with GUID-based polling
 * 
 * Flow:
 * 1. /command spawns a GPT task, returns GUID immediately
 * 2. Client polls GET /chat/:guid to retrieve result
 * 3. Result is deleted from cache once fetched
 * 4. If GPT emits commands (like /websearch), server executes them
 *    and chains another GPT call, returning a new GUID
 */

import { generateUid } from "./uid.js";

export interface GptQueueResult {
  text: string;
  model: string;
  // Commands GPT emitted that were executed
  executedCommands?: number;
  // Updated model after executing GPT's commands
  updatedModel?: unknown;
  // Updated marks after executing GPT's /mark commands
  markedActivities?: string[];
  markedDates?: string[];
  // If there's a follow-up GPT call pending (e.g., after websearch)
  nextGuid?: string;
  // Error if GPT call failed
  error?: string;
}

interface QueueEntry {
  promise: Promise<GptQueueResult>;
  createdAt: number;
  expirationTimer: ReturnType<typeof setTimeout>;
}

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

class GptQueue {
  private cache = new Map<string, QueueEntry>();

  /**
   * Enqueue a GPT task. Returns a GUID the client can poll.
   */
  enqueue(task: () => Promise<GptQueueResult>): string {
    const guid = generateUid();
    const expirationTimer = setTimeout(() => this.expire(guid), CACHE_TTL_MS);
    const entry: QueueEntry = {
      promise: task(),
      createdAt: Date.now(),
      expirationTimer
    };
    this.cache.set(guid, entry);
    
    return guid;
  }

  /**
   * Wait for and retrieve a result. Deletes from cache after retrieval.
   */
  async fetch(guid: string): Promise<GptQueueResult | null> {
    const entry = this.cache.get(guid);
    if (!entry) {
      return null;
    }
    
    // Cancel the expiration timer since we're fetching now
    clearTimeout(entry.expirationTimer);
    
    try {
      const result = await entry.promise;
      return result;
    } finally {
      this.cache.delete(guid);
    }
  }

  /**
   * Check if a GUID exists (for validation)
   */
  has(guid: string): boolean {
    return this.cache.has(guid);
  }

  /**
   * Cancel/expire a pending task
   */
  private expire(guid: string): void {
    const entry = this.cache.get(guid);
    if (entry) {
      clearTimeout(entry.expirationTimer);
      this.cache.delete(guid);
    }
  }

  /**
   * Get current queue size (for debugging)
   */
  get size(): number {
    return this.cache.size;
  }
}

// Singleton instance
export const gptQueue = new GptQueue();
