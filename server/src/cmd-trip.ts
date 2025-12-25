import type { TripCommand } from "./command-types.js";
import { getTripCache } from "./trip-cache.js";
import { registerCommand } from "./command-registry.js";
import type { CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";


function cmdTrip()
{
  function parseTrip(command: CommandWithArgs): TripCommand {
    return { commandId: "trip", target: command.args.target?.trim() || undefined };
  }

  async function handleTrip(
    command: CommandWithArgs,
  ): Promise<CommandHandlerResult> {
    const parsed = parseTrip(command);
    const tripCache = getTripCache();
    const target = parsed.target;
    const trips = await tripCache.listTrips();
    const listMessage = trips.length ? `Existing trips: ${trips.join(", ")}` : "No trips have been created yet.";

    if (!target) {
      return { message: listMessage };
    }

    if (await tripCache.tripExists(target)) {
      // Return switchTrip to signal the command loop to switch to this trip
      return {
        switchTrip: target
      };
    }

    return {
      message: `Trip ${target} not found. ${listMessage}`,
      stopProcessingCommands: true
    };
  }

  return { commandId: "trip", positionalKey: "target", parser: parseTrip, handler: handleTrip };
}
registerCommand(cmdTrip());
