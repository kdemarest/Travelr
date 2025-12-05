/**
 * LazyFile - In-memory cache for a file with lazy writes.
 * 
 * Explicit lifecycle: call load() once at startup, then access data directly.
 * After mutations, call setDirty() to schedule a lazy write. Uses two
 * timers: a debounce timer (resets on each setDirty) and a max delay timer
 * (guarantees write within maxDelayMs even under continuous mutations).
 * 
 * WARNING: You must MUTATE the `data` object in place. NEVER reassign it.
 * The __dataVerifier field catches accidental reassignment at runtime.
 * 
 *   WRONG:  lazyFile.data = { ...lazyFile.data, newKey: value };
 *   RIGHT:  lazyFile.data.newKey = value; lazyFile.setDirty();
 * 
 * Usage:
 *   const usersFile = new LazyFile<UsersFile>(
 *     '/path/to/users.json',
 *     {},
 *     (text) => JSON.parse(text),              // disassemblerFn
 *     (data) => JSON.stringify(data, null, 2)  // reassemblerFn
 *   );
 *   
 *   // At startup - explicit load
 *   usersFile.load();
 *   
 *   // Access data directly (no magic, no I/O)
 *   const users = usersFile.data;
 *   users["newUser"] = { password: "..." };
 *   usersFile.setDirty();  // Schedule lazy write
 *   
 *   // On shutdown - flush pending writes
 *   usersFile.flush();
 */

import fs from "node:fs";
import path from "node:path";

export class LazyFile<T> {
  public data: T;
  private __dataVerifier: T | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxDelayTimer: ReturnType<typeof setTimeout> | null = null;

  /**
   * @param filePath - Absolute path to the file
   * @param defaultValue - Default value if file doesn't exist or can't be parsed
   * @param disassemblerFn - Converts file text to in-memory data structure
   * @param reassemblerFn - Converts in-memory data structure back to file text
   * @param delayMs - Debounce delay before writing to disk (default 5000ms)
   * @param maxDelayMs - Maximum delay before forced write (default 30000ms)
   */
  constructor(
    private filePath: string,
    private defaultValue: T,
    private disassemblerFn: (text: string) => T,
    private reassemblerFn: (data: T) => string,
    private delayMs: number = 5000,
    private maxDelayMs: number = 30000
  ) {
    // Initialize with default; call load() to read from disk
    this.data = defaultValue;
  }
  
  /**
   * Load data from disk. Call once at startup.
   */
  load(): void {
    try {
      const text = fs.readFileSync(this.filePath, "utf-8");
      this.data = this.disassemblerFn(text);
    } catch {
      this.data = this.defaultValue;
    }
    this.assertMutableObject(this.data);
    this.__dataVerifier = this.data;
  }
  
  /**
   * Ensure data is a mutable object (not a primitive).
   * LazyFile requires mutation in place; primitives are immutable.
   */
  private assertMutableObject(data: T): void {
    if (typeof data !== 'object' || data === null) {
      throw new Error(
        `LazyFile(${this.filePath}): data must be a mutable object (array or object), ` +
        `got ${data === null ? 'null' : typeof data}. Primitives are immutable.`
      );
    }
  }
  
  /**
   * Verify that the data reference hasn't been reassigned since load().
   */
  private verifyDataIntegrity(): void {
    if (this.__dataVerifier !== this.data) {
      throw new Error(
        `LazyFile(${this.filePath}): data reference was reassigned. ` +
        `You must mutate the existing data object in place, not reassign it.`
      );
    }
  }
  
  /**
   * Mark data as dirty and schedule a lazy write.
   */
  setDirty(): void {
    this.verifyDataIntegrity();
    
    // Reset debounce timer on each setDirty
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    this.debounceTimer = setTimeout(() => this._commitToStorage(), this.delayMs);
    
    // Start max delay timer only if not already running
    if (!this.maxDelayTimer) {
      this.maxDelayTimer = setTimeout(() => this._commitToStorage(), this.maxDelayMs);
    }
  }
  
  /**
   * Immediately write to disk and cancel all pending timers.
   * Call on shutdown to ensure data is persisted.
   */
  flush(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxDelayTimer) {
      clearTimeout(this.maxDelayTimer);
      this.maxDelayTimer = null;
    }
    this._commitToStorage();
  }
  
  /**
   * Check if there's a pending write.
   */
  hasPendingWrite(): boolean {
    return this.debounceTimer !== null || this.maxDelayTimer !== null;
  }
  
  /**
   * Internal: write data to disk.
   */
  private _commitToStorage(): void {
    this.verifyDataIntegrity();
    
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.maxDelayTimer) {
      clearTimeout(this.maxDelayTimer);
      this.maxDelayTimer = null;
    }
    
    this.ensureDir();
    const text = this.reassemblerFn(this.data);
    fs.writeFileSync(this.filePath, text, "utf-8");
  }
  
  private ensureDir(): void {
    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}
