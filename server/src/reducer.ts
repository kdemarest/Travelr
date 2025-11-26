import { ParsedCommand } from "./command.js";
import { TripModel } from "./types.js";
import { generateUid } from "./uid.js";

export function applyTripCommand(model: TripModel, command: ParsedCommand): TripModel {
  switch (command.type) {
    case "newtrip":
      return { tripName: command.tripId, tripId: command.tripId, activities: [] };
    case "add": {
      const activityUid = command.uid ?? generateUid();
      const activity = {
        uid: activityUid,
        activityType: command.activityType,
        ...command.fields
      };
      return {
        ...model,
        activities: [...model.activities, activity]
      };
    }
    case "edit": {
      const index = model.activities.findIndex((activity) => activity.uid === command.uid);
      if (index === -1) {
        return model;
      }
      const updated = { ...model.activities[index], ...command.changes };
      const activities = [...model.activities];
      activities[index] = updated;
      return { ...model, activities };
    }
    case "delete": {
      const activities = model.activities.filter((activity) => activity.uid !== command.uid);
      if (activities.length === model.activities.length) {
        return model;
      }
      return { ...model, activities };
    }
    case "movedate": {
      const hasMatches = model.activities.some((activity) => activity.date === command.from);
      if (!hasMatches) {
        return model;
      }
      const activities = model.activities.map((activity) =>
        activity.date === command.from ? { ...activity, date: command.to } : activity
      );
      return { ...model, activities };
    }
    case "undo":
    case "redo":
    case "help":
    case "trip":
      return model;
    default:
      return model;
  }
}
