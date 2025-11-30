import type { ParsedCommand } from "./command.js";
import type { CommandResponse } from "./cmd-help.js";
import { getActiveModel, getAvailableModels, setActiveModel } from "./gpt.js";

export function cmdModel(parsed: ParsedCommand): CommandResponse {
  if (parsed.type !== "model") {
    throw new Error("cmdModel called with non-model command");
  }

  const target = parsed.target;

  if (!target) {
    const available = getAvailableModels();
    const current = getActiveModel();
    return {
      status: 200,
      body: {
        ok: true,
        executedCommands: 0,
        message: `Available GPT models: ${available.join(", ")}. Active: ${current}.`,
        models: available,
        activeModel: current
      }
    };
  }

  try {
    setActiveModel(target);
    return {
      status: 200,
      body: {
        ok: true,
        executedCommands: 0,
        message: `ChatGPT model set to ${target}.`,
        activeModel: target
      }
    };
  } catch (error) {
    return {
      status: 400,
      body: { error: error instanceof Error ? error.message : String(error) }
    };
  }
}
