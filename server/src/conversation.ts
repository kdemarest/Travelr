import { LazyFile } from "./lazy-file.js";
import { getStorageFor } from "./storage.js";

// Maximum number of messages to keep in conversation history
const MAX_MESSAGES = 100;

/**
 * Conversation - Represents a single trip's conversation history.
 * 
 * A Conversation knows its trip name and manages its own LazyFile.
 * Uses a sliding window to keep only the most recent messages.
 */
export class Conversation {
  private file: LazyFile<string[]>;
  
  constructor(
    readonly tripName: string,
    key: string
  ) {
    const storage = getStorageFor(key);
    this.file = new LazyFile<string[]>(
      key,
      storage,
      [],
      (text) => text.split(/\r?\n/).filter(line => line.length > 0),
      (messages) => messages.join("\n")
    );
  }
  
  /**
   * Load conversation from storage. Call once when trip is accessed.
   */
  async load(): Promise<void> {
    await this.file.load();
  }
  
  /**
   * Flush pending writes to storage.
   */
  async flush(): Promise<void> {
    await this.file.flush();
  }

  read(): string {
    return this.file.data.join("\n");
  }

  write(contents?: string): void {
    const messages = this.file.data;
    messages.length = 0;  // Clear in place
    
    const data = contents ?? "";
    if (data.trim()) {
      const newMessages = data.split(/\r?\n/).filter(line => line.length > 0);
      messages.push(...newMessages);
    }
    this.file.setDirty();
  }

  append(line: string): void {
    if (!line.trim()) {
      return;
    }
    const messages = this.file.data;
    
    messages.push(line);
    
    // Sliding window: remove oldest messages if over limit
    while (messages.length > MAX_MESSAGES) {
      messages.shift();
    }
    
    this.file.setDirty();
  }
}
