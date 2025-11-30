import type { MarkCommand } from "./command.js";

export interface MarkResult {
  markedActivities: string[];
  markedDates: string[];
}

/**
 * Execute a /mark command by updating the marked arrays.
 * Returns the new state of both arrays.
 */
export function executeMarkCommand(
  command: MarkCommand,
  currentActivities: string[],
  currentDates: string[]
): MarkResult {
  const isActivities = command.markType === "activities";
  
  // Work with the appropriate array
  const currentSet = new Set(isActivities ? currentActivities : currentDates);
  
  // Add items
  for (const item of command.add) {
    currentSet.add(item);
  }
  
  // Remove items
  for (const item of command.remove) {
    currentSet.delete(item);
  }
  
  const updated = Array.from(currentSet);
  
  return {
    markedActivities: isActivities ? updated : currentActivities,
    markedDates: isActivities ? currentDates : updated
  };
}
