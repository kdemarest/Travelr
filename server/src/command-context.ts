import type { Trip } from "./trip.js";
import type { User } from "./user.js";
import { CommandWithArgs } from "./command.js";

// Shared context passed to all command handlers
export interface CommandContext {
  trip: Trip;
  user: User;
}

// Unified handler type - all handlers take (command, ctx)
// Handlers can be sync or async
export type CommandHandler = (
  command: CommandWithArgs,
  ctx: CommandContext
) => CommandHandlerResult | Promise<CommandHandlerResult>;

// Unified result type - covers both journalable and non-journalable commands
export interface CommandHandlerResult {
  // For non-journalable: data to merge into response
  data?: Record<string, unknown>;
  // For journalable: skip writing to journal
  skipJournal?: boolean;
  // Message to include in response
  message?: string;
  // Stop processing remaining commands in the batch (e.g., failed /trip switch)
  stopProcessingCommands?: boolean;
  // Switch to a different trip (for /trip)
  switchTrip?: string;
  // Create a new trip (for /newtrip) - also switches to it
  createTrip?: string;
}
