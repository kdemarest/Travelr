import type { Activity } from "./types";
import { clearFocusedActivityUid, saveFocusedActivityUid, saveFocusedDate } from "./storage";
import { normalizeUserDate } from "./ux-date";

type FocusHost = {
  __getTripId(): string;
  __focusedUid: string | null;
  __focusedDate: string | null;
  __hoveredActivity: Activity | null;
};

type ActivityLookupFn = (uid: string) => Activity | null;
type OnChangeEventFn = () => void;

class PanelFocus {
  private host: FocusHost | null = null;

  private get currentTripId(): string {
    return this.host ? this.host.__getTripId() : "";
  }

  private cachedActivity: Activity | null = null;
  private lookupActivity: ActivityLookupFn | null = null;
  private onDateChange: OnChangeEventFn | null = null;

  attachHost(host: FocusHost, lookupFn: ActivityLookupFn, onDateChange: OnChangeEventFn) {
    this.host = host;
    this.onDateChange = onDateChange;
    this.lookupActivity = lookupFn;
    this.cachedActivity = null;
  }

  detachHost(host: FocusHost) {
    if (this.host === host) {
      this.host = null;
      this.onDateChange = null;
      this.lookupActivity = null;
      this.cachedActivity = null;
    }
  }

  get activityUid(): string | null {
    return this.host?.__focusedUid ?? null;
  }

  set activityUid(uid: string | null) {
    if (!this.host) {
      return;
    }
    const previousUid = this.host.__focusedUid;
    this.host.__focusedUid = uid;
    if (previousUid !== uid) {
      this.cachedActivity = null;
    }
    if (uid && this.lookupActivity) {
      const activity = this.lookupActivity(uid);
      if (activity) {
        this.cachedActivity = activity;
        this.hoveredActivity = activity;
      }
    }
    if (!uid) {
      this.hoveredActivity = null;
    }
    if (!this.currentTripId) {
      return;
    }
    if (uid) {
      saveFocusedActivityUid(this.currentTripId, uid);
    } else {
      clearFocusedActivityUid(this.currentTripId);
    }
  }

  get activity(): Activity | null {
    const uid = this.activityUid;
    if (!uid || !this.host) {
      this.cachedActivity = null;
      return null;
    }

    if (this.cachedActivity?.uid === uid) {
      return this.cachedActivity;
    }

    const activity = this.lookupActivity ? this.lookupActivity(uid) : null;
    this.cachedActivity = activity;
    return activity;
  }

  set activity(activity: Activity | null) {
    if (!this.host) {
      return;
    }
    this.cachedActivity = activity;
    this.activityUid = activity ? activity.uid : null;
    this.hoveredActivity = activity;
  }

  get date(): string | null {
    return this.host?.__focusedDate ?? null;
  }

  set date(rawDate: string | null) {
    if (!this.host) {
      return;
    }

    const date = rawDate ? normalizeUserDate(rawDate) : null;
    if (this.host.__focusedDate === date) {
      return;
    }

    this.host.__focusedDate = date;
    if (this.currentTripId) {
      saveFocusedDate(this.currentTripId, date);
    }

    this.ensureActivityMatchesFocusedDate();

    if (this.onDateChange) {
      this.onDateChange();
    }
  }

  syncWithActivities(activities: Activity[]) {
    if (!this.host) {
      return;
    }

    const uid = this.activityUid;
    const matched = uid ? activities.find((activity) => activity.uid === uid) ?? null : null;
    if (!matched) {
      this.activityUid = null;
      this.cachedActivity = null;
    } else if (!this.hoveredActivity) {
      this.hoveredActivity = matched;
    }
    if (this.hoveredActivity) {
      const hoveredMatch = activities.some((activity) => activity.uid === this.hoveredActivity?.uid);
      if (!hoveredMatch) {
        this.hoveredActivity = null;
      }
    }
  }

  get hoveredActivity(): Activity | null {
    return this.host?.__hoveredActivity ?? null;
  }

  set hoveredActivity(activity: Activity | null) {
    if (!this.host) {
      return;
    }
    this.host.__hoveredActivity = activity;
  }

  private ensureActivityMatchesFocusedDate() {
    const focusedDate = this.host?.__focusedDate ?? null;
    const currentUid = this.activityUid;
    if (!focusedDate || !currentUid || !this.lookupActivity) {
      return;
    }
    const activity = this.lookupActivity(currentUid);
    if (!activity) {
      this.activityUid = null;
      this.hoveredActivity = null;
      return;
    }
    const activityDate = activity.date ? normalizeUserDate(activity.date) ?? activity.date : null;
    if (!activityDate || activityDate !== focusedDate) {
      this.activityUid = null;
      this.hoveredActivity = null;
    }
  }

  describeFocus(): string {
    const dateText = this.date ?? "none";
    const activityUidText = this.activityUid ?? "none";
    return `date is ${dateText}. activity uid is ${activityUidText}.`;
  }
}

export const panelFocus = new PanelFocus();
