/**
 * Trip - Represents a single trip with its journal and conversation.
 * 
 * Call load() once when trip is accessed, then data access is sync.
 */

import { Journal } from "./journal.js";
import { Conversation } from "./conversation.js";

export class Trip {
  readonly journal: Journal;
  readonly conversation: Conversation;
  private loaded = false;
  
  constructor(
    readonly name: string,
    journalPath: string,
    conversationPath: string
  ) {
    this.journal = new Journal(name, journalPath);
    this.conversation = new Conversation(name, conversationPath);
  }
  
  /**
   * Load trip data from disk. Call once when trip is accessed.
   */
  async load(): Promise<void> {
    if (this.loaded) return;
    await Promise.all([
      this.journal.load(),
      this.conversation.load()
    ]);
    this.loaded = true;
  }
  
  /**
   * Check if trip has been loaded.
   */
  isLoaded(): boolean {
    return this.loaded;
  }
  
  async flush(): Promise<void> {
    await Promise.all([
      this.journal.flush(),
      this.conversation.flush()
    ]);
  }
}
