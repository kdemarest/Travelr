/**
 * Helpers to populate the ClientDataCache with common data.
 * 
 * These functions know how to gather data and set it in the cache.
 * The ClientDataCache itself remains pure and knows nothing about
 * trips, models, etc.
 */

import type { User } from "./user.js";
import { getTripCache } from "./trip-cache.js";
import { getActiveModel, getAvailableModels, setActiveModel, isOpenAIAvailable } from "./gpt.js";
import { getLastModel } from "./auth.js";

/**
 * Populate the tripList in the user's client data cache.
 */
export async function populateTripList(user: User): Promise<void> {
  const tripCache = getTripCache();
  const trips = await tripCache.listTrips();
  user.clientDataCache.set("tripList", trips);
}

/**
 * Apply the user's preferred GPT model if available.
 */
export function applyUserModelPreference(user: User): void {
  const preferred = getLastModel(user.userId);
  console.log(`[applyUserModelPreference] user=${user.userId} preferred=${preferred}`);
  if (!preferred) {
    return;
  }

  const available = getAvailableModels();
  console.log("[applyUserModelPreference] available:", available);
  if (!available.includes(preferred)) {
    console.log(`[applyUserModelPreference] preferred ${preferred} not available`);
    return;
  }

  const current = getActiveModel();
  console.log(`[applyUserModelPreference] current=${current}`);
  if (current === preferred) {
    return;
  }

  try {
    console.log(`[applyUserModelPreference] switching model to ${preferred}`);
    setActiveModel(preferred);
  } catch (error) {
    console.warn(`[applyUserModelPreference] Failed to set model ${preferred}:`, error);
  }
}

/**
 * Populate the modelList and activeModel in the user's client data cache.
 */
export async function populateModelList(user: User): Promise<void> {
  const models = getAvailableModels();
  const activeModel = getActiveModel();
  const chatbotAvailable = await isOpenAIAvailable();
  console.log("[populateModelList] models:", models);
  console.log("[populateModelList] activeModel:", activeModel);
  console.log("[populateModelList] chatbotAvailable:", chatbotAvailable);
  user.clientDataCache.set("modelList", models);
  user.clientDataCache.set("activeModel", activeModel);
  user.clientDataCache.set("chatbotAvailable", chatbotAvailable);
  console.log("[populateModelList] cache isDirty after sets:", user.clientDataCache.isDirty());
}

/**
 * Populate all bootstrap data (trips, models) for initial login/auth.
 */
export async function populateBootstrapData(user: User): Promise<void> {
  console.log("[populateBootstrapData] starting for user:", user.userId);
  await populateTripList(user);
  applyUserModelPreference(user);
  await populateModelList(user);
  console.log("[populateBootstrapData] complete, cache isDirty:", user.clientDataCache.isDirty());
  console.log("[populateBootstrapData] cache data:", user.clientDataCache.getData());
}
