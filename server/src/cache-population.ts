/**
 * Helpers to populate the ClientDataCache with common data.
 * 
 * These functions know how to gather data and set it in the cache.
 * The ClientDataCache itself remains pure and knows nothing about
 * trips, models, etc.
 */

import type { User } from "./user.js";
import { getTripCache } from "./trip-cache.js";
import { getActiveModel, getAvailableModels } from "./gpt.js";

/**
 * Populate the tripList in the user's client data cache.
 */
export async function populateTripList(user: User): Promise<void> {
  const tripCache = getTripCache();
  const trips = await tripCache.listTrips();
  user.clientDataCache.set("tripList", trips);
}

/**
 * Populate the modelList and activeModel in the user's client data cache.
 */
import { isOpenAIAvailable } from "./gpt.js";

export async function populateModelList(user: User): Promise<void> {
  const models = getAvailableModels();
  const activeModel = getActiveModel();
  user.clientDataCache.set("modelList", models);
  user.clientDataCache.set("activeModel", activeModel);
  user.clientDataCache.set("chatbotAvailable", await isOpenAIAvailable());
}

/**
 * Populate all bootstrap data (trips, models) for initial login/auth.
 */
export async function populateBootstrapData(user: User): Promise<void> {
  await populateTripList(user);
  await populateModelList(user);
}
