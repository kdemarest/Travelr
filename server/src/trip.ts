/**
 * Trip - Represents a single trip with its journal and conversation.
 * 
 * Call load() once when trip is accessed, then data access is sync.
 * 
 * NOTE: journalKey and conversationKey must be RELATIVE storage keys
 * (e.g., "dataTrips/Japan.travlrjournal"), not absolute paths.
 */

import { Journal } from "./journal.js";
import { Conversation } from "./conversation.js";

export class Trip {
  readonly journal: Journal;
  readonly conversation: Conversation;
  private loaded = false;
  
  constructor(
    readonly name: string,
    journalKey: string,
    conversationKey: string
  ) {
    this.journal = new Journal(name, journalKey);
    this.conversation = new Conversation(name, conversationKey);
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
