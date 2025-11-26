export class CommandError extends Error {
  constructor(message: string, public readonly statusCode: number = 400) {
    super(message);
    this.name = "CommandError";
  }
}

export class JournalError extends Error {
  constructor(message: string, public readonly statusCode: number = 400) {
    super(message);
    this.name = "JournalError";
  }
}
