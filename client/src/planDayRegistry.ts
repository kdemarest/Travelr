import type { Activity, PlanLine } from "./types";
import { normalizeUserDate } from "./ux-date";

export interface PlanDayEntry {
  key: string;
  index: number;
  displayDate: string;
  fullDisplayDate: string;
  notation: string;
  activities: Activity[];
  activityCount: number;
  hasActivities: boolean;
  isMarked: boolean;
}

class PlanDayRegistry {
  private dayMap = new Map<string, PlanDayEntry>();
  private orderedKeys: string[] = [];
  private listeners = new Set<(entries: PlanDayEntry[]) => void>();

  updateFromPlanLines(lines: PlanLine[]): void {
    this.dayMap.clear();
    this.orderedKeys = [];
    lines.forEach((line, index) => {
      if (line.kind !== "dated") {
        return;
      }
      const entry: PlanDayEntry = {
        key: line.date,
        index,
        displayDate: line.displayDate,
        fullDisplayDate: line.fullDisplayDate,
        notation: line.notation,
        activities: [...line.activities],
        activityCount: line.activities.length,
        hasActivities: line.activities.length > 0,
        isMarked: Boolean(line.isDateMarked)
      };
      this.dayMap.set(entry.key, entry);
      this.orderedKeys.push(entry.key);
    });
    this.emitChange();
  }

  getDay(key: string | null | undefined): PlanDayEntry | null {
    if (!key) {
      return null;
    }
    const normalized = normalizeUserDate(key) ?? key;
    return this.dayMap.get(normalized) ?? null;
  }

  getAllDays(): PlanDayEntry[] {
    return this.orderedKeys
      .map((key) => this.dayMap.get(key) ?? null)
      .filter((entry): entry is PlanDayEntry => entry !== null);
  }

  subscribe(listener: (entries: PlanDayEntry[]) => void): () => void {
    this.listeners.add(listener);
    listener(this.getAllDays());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emitChange() {
    const snapshot = this.getAllDays();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export const planDayRegistry = new PlanDayRegistry();
