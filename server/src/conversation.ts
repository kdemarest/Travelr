import fs from "fs-extra";
import path from "node:path";

export class ConversationStore {
  constructor(private readonly dataDir: string) {}

  private getConversationPath(tripName: string) {
    return path.join(this.dataDir, `${tripName}.conversation`);
  }

  async read(tripName: string): Promise<string> {
    const filePath = this.getConversationPath(tripName);
    if (!(await fs.pathExists(filePath))) {
      return "";
    }
    return fs.readFile(filePath, "utf8");
  }

  async write(tripName: string, contents?: string): Promise<void> {
    const filePath = this.getConversationPath(tripName);
    const data = contents ?? "";
    if (!data.trim()) {
      await fs.remove(filePath).catch(() => undefined);
      return;
    }
    await fs.outputFile(filePath, data, "utf8");
  }
}
