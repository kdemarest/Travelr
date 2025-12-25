/**
 * LazyAppendFile - Append-only file with in-memory caching.
 * 
 * Explicit lifecycle: call load() once when the file is first needed,
 * then access data directly via sync methods. Appends update memory
 * immediately and are debounced to storage.
 * 
 * Designed for journal files where:
 * - Reads are frequent (every request rebuilds model)
 * - Writes are append-only
 * - No need to rewrite entire file
 */

import type { Storage } from "./storage.js";

export class LazyAppendFile<T> {
  private lines: string[] = [];           // Raw lines
  private parsed: T[] = [];               // Parsed entries
  private loaded = false;                 // Whether load() has been called
  private pendingAppends: string[] = [];  // Lines waiting to be flushed
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDelayTimer: ReturnType<typeof setTimeout> | null = null;
  
  constructor(
    private readonly key: string,
    private readonly storage: Storage,
    private readonly parseLine: (line: string, index: number) => T,
    private readonly debounceMs: number = 100,   // Short debounce for batching rapid appends
    private readonly maxDelayMs: number = 5000   // Max time before forced write
  ) {}
  
  /**
   * Load and parse the file. Call once when trip is accessed.
   */
  async load(): Promise<void> {
    const contents = await this.storage.read(this.key);
    if (contents !== null) {
      this.lines = contents
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0);
      this.parsed = this.lines.map((line, index) => this.parseLine(line, index));
    } else {
      this.lines = [];
      this.parsed = [];
    }
    this.loaded = true;
  }
  
  /**
   * Check if file has been loaded.
   */
  isLoaded(): boolean {
    return this.loaded;
  }
  
  /**
   * Get all parsed entries. Must call load() first.
   */
  getEntries(): T[] {
    this.assertLoaded();
    return this.parsed;
  }
  
  /**
   * Get all raw lines. Must call load() first.
   */
  getLines(): string[] {
    this.assertLoaded();
    return this.lines;
  }
  
  /**
   * Get entry count. Must call load() first.
   */
  count(): number {
    this.assertLoaded();
    return this.parsed.length;
  }
  
  /**
   * Check if file exists (has been created). Must call load() first.
   */
  exists(): boolean {
    this.assertLoaded();
    return this.lines.length > 0;
  }
  
  private assertLoaded(): void {
    if (!this.loaded) {
      throw new Error(`LazyAppendFile(${this.key}): load() must be called before accessing data`);
    }
  }
  
  /**
   * Append a line. Updates cache immediately, debounces disk write.
   * Must call load() first.
   */
  append(line: string): void {
    this.assertLoaded();
    
    const trimmedLine = line.trimEnd();
    const index = this.lines.length;
    
    // Update in-memory cache immediately
    this.lines.push(trimmedLine);
    this.parsed.push(this.parseLine(trimmedLine, index));
    
    // Queue for disk write
    this.pendingAppends.push(trimmedLine + "\n");
    this.scheduleFlush();
  }
  
  /**
   * Create the file with initial content (for new trips).
   */
  async create(initialLine: string): Promise<void> {
    if (await this.storage.exists(this.key)) {
      throw new Error(`File already exists: ${this.key}`);
    }
    
    const trimmedLine = initialLine.trimEnd();
    
    // Write immediately (no debounce for creation)
    await this.storage.write(this.key, trimmedLine + "\n");
    
    // Initialize cache
    this.lines = [trimmedLine];
    this.parsed = [this.parseLine(trimmedLine, 0)];
    this.loaded = true;
  }
  
  /**
   * Create an empty file. Used by /newtrip to create the journal file.
   */
  async createEmpty(): Promise<void> {
    if (await this.storage.exists(this.key)) {
      throw new Error(`File already exists: ${this.key}`);
    }
    
    // Write empty file immediately
    await this.storage.write(this.key, "");
    
    // Initialize empty cache
    this.lines = [];
    this.parsed = [];
    this.loaded = true;
  }
  
  private scheduleFlush(): void {
    // Start max delay timer on first pending append (guarantees write within maxDelayMs)
    if (!this.maxDelayTimer) {
      this.maxDelayTimer = setTimeout(() => {
        this._flushToStorage().catch(err =>
          console.error(`[LazyAppendFile] Failed to flush ${this.key}:`, err)
        );
      }, this.maxDelayMs);
    }
    
    // Reset debounce timer on each append
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => {
      this._flushToStorage().catch(err =>
        console.error(`[LazyAppendFile] Failed to flush ${this.key}:`, err)
      );
    }, this.debounceMs);
  }
  
  private async _flushToStorage(): Promise<void> {
    // Clear both timers
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxDelayTimer) {
      clearTimeout(this.maxDelayTimer);
      this.maxDelayTimer = null;
    }
    
    if (this.pendingAppends.length === 0) return;
    
    const toWrite = this.pendingAppends.join("");
    this.pendingAppends = [];
    
    await this.storage.append(this.key, toWrite);
  }
  
  /**
   * Flush any pending appends immediately. Call on shutdown.
   */
  async flush(): Promise<void> {
    await this._flushToStorage();
  }
  
  /**
   * Clear the cache (forces reload on next load() call).
   * Flushes pending writes first.
   */
  async invalidate(): Promise<void> {
    await this.flush();
    this.lines = [];
    this.parsed = [];
    this.loaded = false;
  }
}
