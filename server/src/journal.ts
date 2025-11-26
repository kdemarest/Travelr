import fs from "fs-extra";
import path from "node:path";
import { ParsedCommand } from "./command.js";
import { JournalError } from "./errors.js";

export class JournalService {
  constructor(private readonly dataDir: string) {}

  private getJournalPath(tripName: string) {
    return path.join(this.dataDir, `${tripName}.travlrjournal`);
  }

  async appendCommand(tripName: string, command: ParsedCommand, rawLine: string): Promise<void> {
    const filePath = this.getJournalPath(tripName);
    const sanitizedLine = rawLine.trimEnd() + "\n";

    if (command.type === "newtrip") {
      if (command.tripId !== tripName) {
        throw new JournalError("tripId in /newtrip must match requested trip.");
      }
      if (await fs.pathExists(filePath)) {
        throw new JournalError(`Trip ${tripName} already exists.`, 409);
      }
      await fs.outputFile(filePath, sanitizedLine, "utf8");
      return;
    }

    if (!(await fs.pathExists(filePath))) {
      throw new JournalError(`Trip ${tripName} does not exist.`, 404);
    }

    await fs.appendFile(filePath, sanitizedLine, "utf8");
  }
}
