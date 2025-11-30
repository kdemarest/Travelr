/**
 * Model Finalization - Single point for preparing a TripModel for client consumption
 * 
 * This ensures all derived data (exchange rates, durations, day summaries) is
 * computed consistently whenever a model is sent to the client.
 */

import type { TripModel } from "./types.js";
import { refreshExchangeRatesFromOnlineSources } from "./exchange.js";
import { decorateModelWithDurations } from "./duration.js";
import { computeDaySummaries } from "./day-summary.js";

/**
 * Finalize a TripModel for client consumption.
 * 
 * This should be called on any TripModel before:
 * - Sending it to the client in an API response
 * - Using it to build an LLM prompt
 * 
 * Steps:
 * 1. Refresh exchange rates from online sources
 * 2. Normalize/decorate duration fields
 * 3. Compute day summaries (derived metrics per day)
 */
export async function finalizeModel(model: TripModel): Promise<TripModel> {
  const withRates = await refreshExchangeRatesFromOnlineSources(model);
  const withDurations = decorateModelWithDurations(withRates);
  const daySummaries = computeDaySummaries(withDurations);
  return { ...withDurations, daySummaries };
}
