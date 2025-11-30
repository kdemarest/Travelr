import type { Request, Response } from "express";
import type { TripDocService } from "./tripdoc.js";
import type { ConversationStore } from "./conversation.js";
import { finalizeModel } from "./finalize-model.js";
import { getDefaultUserPreferences } from "./user-preferences.js";
import { getActiveModel, sendChatCompletion } from "./gpt.js";

export function createChatHandler(tripDocService: TripDocService, conversationStore: ConversationStore) {
  return async (req: Request, res: Response) => {
    const tripName = req.params.tripName;
    const { text, focusSummary, markedActivities, markedDates } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Payload must include text." });
    }

    const normalizedInput = text.trim();
    const normalizedFocus = typeof focusSummary === "object" ? focusSummary : undefined;
    const normalizedMarks = normalizeMarkedActivities(markedActivities);
    const normalizedDates = normalizeMarkedActivities(markedDates);
    const mergedFocusSummary = mergeFocusSummaryWithMarks(normalizedFocus, normalizedMarks, normalizedDates);

    try {
      const model = await tripDocService.getExistingModel(tripName);
      if (!model) {
        return res.status(404).json({ error: `Trip ${tripName} does not exist.` });
      }
      const finalizedModel = await finalizeModel(model);
      const userPreferences = await getDefaultUserPreferences();

      // Read conversation history from disk (authoritative source)
      const conversationHistory = await conversationStore.read(tripName);

      // Append user input to conversation
      await conversationStore.append(tripName, `User: ${normalizedInput}`);

      const result = await sendChatCompletion(normalizedInput, {
        temperature: 0.3,
        templateContext: {
          tripModel: finalizedModel,
          userInput: normalizedInput,
          conversationHistory,
          focusSummary: mergedFocusSummary,
          userPreferences,
          markedActivities: normalizedMarks,
          markedDates: normalizedDates
        }
      });

      // Append GPT response to conversation
      const modelName = getActiveModel();
      await conversationStore.append(tripName, `GPT (${modelName}): ${result.text}`);

      res.json({ ok: true, text: result.text, model: modelName });
    } catch (error) {
      console.error("Chat completion failed", error);
      const message = error instanceof Error ? error.message : "Failed to reach OpenAI.";
      res.status(502).json({ error: message });
    }
  };
}

function normalizeMarkedActivities(input: unknown): string[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const unique = new Set<string>();
  for (const value of input) {
    if (typeof value !== "string") {
      continue;
    }
    const trimmed = value.trim();
    if (trimmed.length) {
      unique.add(trimmed);
    }
  }
  return Array.from(unique.values());
}

function mergeFocusSummaryWithMarks(
  focusSummary?: { focusedDate?: string | null; focusedActivityUid?: string | null },
  markedActivities?: string[],
  markedDates?: string[]
): string {
  const normalized = {
    focusedDate: focusSummary?.focusedDate ?? null,
    focusedActivityUid: focusSummary?.focusedActivityUid ?? null
  };

  const marks = Array.isArray(markedActivities) ? markedActivities : [];
  const dates = Array.isArray(markedDates) ? markedDates : [];
  return JSON.stringify({ ...normalized, markedActivities: marks, markedDates: dates }, null, 2);
}
