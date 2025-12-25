// /newtrip command handler
import { registerCommand } from "./command-registry.js";
import { TRIP_ID_PATTERN } from "./command-parser-helpers.js";
import { CommandError } from "./errors.js";
import type { NewTripCommand } from "./command-types.js";
import type { CommandHandlerResult, CommandContext } from "./command-context.js";
import { CommandWithArgs } from "./command.js";
import { getTripCache } from "./trip-cache.js";


function cmdNewtrip()
{
  async function handleNewtrip(
    command: CommandWithArgs,
    _ctx: CommandContext
  ): Promise<CommandHandlerResult> {
    const parsed = parseNewTrip(command);
    
    // Check if trip already exists - error if so
    const tripCache = getTripCache();
    if (await tripCache.tripExists(parsed.tripId)) {
      throw new CommandError(`Trip "${parsed.tripId}" already exists. Use /trip to switch to it.`);
    }
    
    // Return createTrip to signal the command loop to create a new trip
    return {
      createTrip: parsed.tripId
    };
  }

  function parseNewTrip(command: CommandWithArgs): NewTripCommand {
    const tripId = command.args.tripId;
    if (!tripId) {
      throw new CommandError("/newtrip requires tripId=\"...\".");
    }

    if (!TRIP_ID_PATTERN.test(tripId)) {
      throw new CommandError("tripId may only contain letters, numbers, underscore, or dash.");
    }

    return { commandId: "newtrip", tripId };
  }

  return { commandId: "newtrip", positionalKey: "tripId", parser: parseNewTrip, handler: handleNewtrip };
}
registerCommand(cmdNewtrip());
