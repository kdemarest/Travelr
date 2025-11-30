import type { ParsedCommand, TripCommand } from "./command.js";
import type { CommandResponse } from "./cmd-help.js";
import { TripDocService } from "./tripdoc.js";
import { finalizeModel } from "./finalize-model.js";

export async function cmdTrip(
  parsed: ParsedCommand,
  tripDocService: TripDocService
): Promise<CommandResponse> {
  if (parsed.type !== "trip") {
    throw new Error("cmdTrip called with non-trip command");
  }

  const target = parsed.target;
  const trips = await tripDocService.listTrips();
  const listMessage = trips.length ? `Existing trips: ${trips.join(", ")}` : "No trips have been created yet.";

  if (!target) {
    return {
      status: 200,
      body: { ok: true, executedCommands: 0, message: listMessage, trips }
    };
  }

  const model = await tripDocService.getExistingModel(target);
  if (model) {
    const finalizedModel = await finalizeModel(model);
    return {
      status: 200,
      body: { ok: true, executedCommands: 0, message: `Now editing ${target}`, model: finalizedModel, trips }
    };
  }

  return {
    status: 404,
    body: { error: `Trip ${target} not found. ${listMessage}`, trips }
  };
}
