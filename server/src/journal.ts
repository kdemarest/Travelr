import { JournalError } from "./errors.js";
import { LazyAppendFile } from "./lazy-append-file.js";
import { CommandWithArgs } from "./command.js";
import { getStorageFor } from "./storage.js";

/**
 * Journal - Represents a single trip's journal file.
 * 
 * A Journal knows its trip name and manages its own LazyAppendFile.
 * Call load() once when trip is accessed, then operations are sync.
 * 
 * WARNING: The key must be a RELATIVE storage key (e.g., "dataTrips/Japan.travlrjournal"),
 * not an absolute path. The Storage abstraction adds the basePath.
 */


export interface JournalEntry {
  lineNumber: number;
  command: CommandWithArgs;
}

function parseJournalLine(line: string, index: number): JournalEntry {
  return {
    lineNumber: index + 1,
    command: new CommandWithArgs(line)
  };
}

export class Journal {
  private file: LazyAppendFile<JournalEntry>;
  private storage;
  
  constructor(
    readonly tripName: string,
    private readonly key: string
  ) {
    this.storage = getStorageFor(key);
    this.file = new LazyAppendFile(key, this.storage, parseJournalLine);
  }
  
  /**
   * Load journal from storage. Call once when trip is accessed.
   */
  async load(): Promise<void> {
    await this.file.load();
  }
  
  /**
   * Check if journal has been loaded.
   */
  isLoaded(): boolean {
    return this.file.isLoaded();
  }
  
  /**
   * Get all journal entries. Must call load() first.
   */
  getEntries(): JournalEntry[] {
    return this.file.getEntries();
  }

  /**
   * Get the next line number for a new entry.
   */
  get nextLineNumber(): number {
    const entries = this.file.getEntries();
    const lastEntry = entries[entries.length - 1];
    return (lastEntry?.lineNumber ?? 0) + 1;
  }
  
  /**
   * Append a command to the journal.
   * Throws JournalError with appropriate status codes.
   */
  async appendCommand(command: CommandWithArgs, rawLine: string): Promise<void> {
    const sanitizedLine = rawLine.trimEnd();
    
    if (command.commandId === "newtrip") {
      const tripId = command.args["tripId"];
      if (tripId !== this.tripName) {
        throw new JournalError("tripId in /newtrip must match requested trip.", 400);
      }
      if (await this.storage.exists(this.key)) {
        throw new JournalError(`Trip ${this.tripName} already exists.`, 409);
      }
      await this.file.create(sanitizedLine);
      return;
    }
    
    if (!await this.storage.exists(this.key)) {
      throw new JournalError(`Trip ${this.tripName} does not exist.`, 404);
    }
    
    this.file.append(sanitizedLine);
  }
  
  /**
   * Create an empty journal file. Used by /newtrip.
   */
  async createEmpty(): Promise<void> {
    await this.file.createEmpty();
  }
  
  /**
   * Flush pending writes.
   */
  async flush(): Promise<void> {
    await this.file.flush();
  }

  /**
   * Create a new JournalEntry with the next line number.
   * Does NOT persist - call appendCommand to persist.
   */
  createEntry(command: CommandWithArgs): JournalEntry {
    const entries = this.getEntries();
    const lastLineNumber = entries[entries.length - 1]?.lineNumber ?? 0;
    const lineNumber = lastLineNumber + 1;
    return { lineNumber, command };
  }
}

