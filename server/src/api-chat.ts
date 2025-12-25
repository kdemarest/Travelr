import type { Request, Response } from "express";
import type { TripCache } from "./trip-cache.js";
import { rebuildModel } from "./journal-state.js";
import { finalizeModel } from "./finalize-model.js";
import { getActiveModel, sendChatCompletion } from "./gpt.js";
import type { AuthenticatedRequest } from "./index.js";

export function createChatHandler(tripCache: TripCache) {
  return async (req: Request, res: Response) => {
    const tripName = req.params.tripName;
    const { text, focusSummary, markedActivities, markedDates } = req.body ?? {};
    if (typeof text !== "string" || !text.trim()) {
      return res.status(400).json({ error: "Payload must include text." });
    }

    const user = (req as AuthenticatedRequest).user;
    const normalizedInput = text.trim();
    const normalizedFocus = typeof focusSummary === "object" ? focusSummary : undefined;
    const normalizedMarks = normalizeMarkedActivities(markedActivities);
    const normalizedDates = normalizeMarkedActivities(markedDates);
    const mergedFocusSummary = mergeFocusSummaryWithMarks(normalizedFocus, normalizedMarks, normalizedDates);

    try {
      if (!(await tripCache.tripExists(tripName))) {
        return res.status(404).json({ error: `Trip ${tripName} does not exist.` });
      }
      const trip = await tripCache.getTrip(tripName);
      const model = rebuildModel(trip);
      const finalizedModel = finalizeModel(model);
      const userPrefsFile = await user.getPrefsFile();
      const userPreferences = { ...userPrefsFile.data };

      // Read conversation history from disk (authoritative source)
      const conversation = trip.conversation;
      const conversationHistory = conversation.read();

      // Append user input to conversation
      conversation.append(`User:\n${normalizedInput}`);

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
      conversation.append(`Chatbot:\n${result.text}`);

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
