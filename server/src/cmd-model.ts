import type { ModelCommand } from "./command-types.js";
import { getActiveModel, getAvailableModels, setActiveModel } from "./gpt.js";
import { registerCommand } from "./command-registry.js";
import type { CommandContext, CommandHandlerResult } from "./command-context.js";
import { CommandWithArgs } from "./command.js";
import { populateModelList } from "./cache-population.js";


function cmdModel()
{
  function parseModel(command: CommandWithArgs): ModelCommand {
    return { commandId: "model", target: command.args.target?.trim() || undefined };
  }

  async function handleModel(
    command: CommandWithArgs,
    ctx: CommandContext
  ): Promise<CommandHandlerResult> {
    const parsed = parseModel(command);
    const target = parsed.target;

    // Update the client data cache with model info
    await populateModelList(ctx.user);

    if (!target) {
      const available = getAvailableModels();
      const current = getActiveModel();
      return {
        message: `Available GPT models: ${available.join(", ")}. Active: ${current}.`
      };
    }

    try {
      setActiveModel(target);
      // Update cache again after change
      await populateModelList(ctx.user);
      return {
        message: `ChatGPT model set to ${target}.`
      };
    } catch (error) {
      return {
        message: error instanceof Error ? error.message : String(error),
        stopProcessingCommands: true
      };
    }
  }

  return { commandId: "model", positionalKey: "target", adminOnly: true, parser: parseModel, handler: handleModel };
}
registerCommand(cmdModel());
