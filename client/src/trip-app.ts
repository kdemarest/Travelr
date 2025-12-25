import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { Activity, PlanLine, TripModel } from "./types";
import { buildPlanLines, describeActivity } from "./view/view-plan";
import type { DayEntry } from "./view/view-day";
import { buildDayItems } from "./view/view-day";
import { panelFocus } from "./focus";
import { panelMarks, panelDateMarks } from "./panelMarks";
import { planDayRegistry } from "./planDayRegistry";
import { normalizeUserDate } from "./ux-date";
import type { PanelDetailLogEntry } from "./components/panel-detail";
import {
  saveFocusedDate,
  loadFocusedDate,
  loadFocusedActivityUid,
} from "./storage";
import { AppAuth, authStyles } from "./app-auth";
import { AppCommands } from "./app-commands";
import { AppConversation } from "./app-conversation";
import "./components/panel-plan";
import "./components/panel-day";
import "./components/panel-activity";
import "./components/panel-detail";

const DEFAULT_ACTIVITY_TO_CREATE = "visit";

@customElement("trip-app")
export class TripApp extends LitElement {
  // --- Shared state ---
  @state() private tripModel: TripModel | null = null;
  @state() private currentTripId: string | null = null;
  @state() __focusedUid: string | null = null;
  @state() __focusedDate: string | null = null;
  @state() __hoveredActivity: Activity | null = null;

  // --- Plan panel state ---
  @state() private planTitle = "Untitled Trip";
  @state() private planLines: PlanLine[] = [];

  // --- Day panel state ---
  @state() private dayTitle = "Day";
  @state() private dayItems: DayEntry[] = [];
  @state() private dayFlightCount = 0;
  @state() private dayFlightBooked = false;
  @state() private dayHasRentalCar = false;
  @state() private dayRentalCarBooked = false;
  @state() private dayLodgingStatus: "none" | "unbooked" | "booked" | "multiple" = "none";
  @state() private dayLodgingCity?: string;
  @state() private dayMealCount = 0;
  @state() private dayMealsNeedingReservation = 0;
  @state() private dayHasDateMismatchIssue = false;
  @state() private dayIssueNoTransportToLodging = false;
  @state() private dayIssueNoTransportToFlight = false;
  @state() private dayMismatchedUids: Set<string> = new Set();
  @state() private activityUidsWithAlarms: Set<string> = new Set();
  @state() private dayDragPlanState: { uid: string; date: string | null } | null = null;

  // --- Marks state ---
  @state() private markedActivityIds: string[] = [];
  @state() private markedDateKeys: string[] = [];
  private markedActivitySet: Set<string> = new Set();
  private markedDateSet: Set<string> = new Set();
  private activityMarksUnsubscribe: (() => void) | null = null;
  private dateMarksUnsubscribe: (() => void) | null = null;

  // --- Auth state (delegated to AppAuth) ---
  @state() private authRequired = false;
  @state() private authChecking = true;
  @state() private authUser: string | null = null;
  @state() private userMenuOpen = false;
  @state() private availableTrips: string[] = [];

  // --- Command/conversation state (delegated) ---
  @state() private messages: PanelDetailLogEntry[] = [];
  @state() private sending = false;

  // --- Controllers ---
  private appAuth: AppAuth;
  private appCommands: AppCommands;
  private appConversation: AppConversation;

  // --- Internal state ---
  private attemptedAutoRestore = false;

  constructor() {
    super();

    // Initialize AppAuth
    this.appAuth = new AppAuth({
      onAuthComplete: (user, lastTripId) => {
        if (lastTripId) {
          this.currentTripId = lastTripId;
        }
        this.tryAutoRestoreTrip();
        void this.appConversation.loadConversationHistory(this.currentTripId);
      },
      onLogout: () => {
        // Could reset trip state here if needed
      },
      requestUpdate: () => this.syncAuthState()
    });

    // Initialize AppConversation
    this.appConversation = new AppConversation({
      requestUpdate: () => {
        this.messages = this.appConversation.messages;
      }
    });

    // Initialize AppCommands
    this.appCommands = new AppCommands({
      appendMessage: (msg, meta) => this.appConversation.appendMessage(msg, meta),
      updateMessage: (id, text, opts) => this.appConversation.updateMessage(id, text, opts),
      appendLogEntry: (entry) => this.appConversation.appendLogEntry(entry),
      setSending: (sending) => { this.sending = sending; },
      rememberTripModel: (model) => this.rememberTripModel(model),
      requestUpdate: () => this.requestUpdate(),
      getCurrentTripId: () => this.currentTripId,
      getMarkedActivityIds: () => this.markedActivityIds,
      getMarkedDateKeys: () => this.markedDateKeys,
      getTripModel: () => this.tripModel,
      nextLogEntryId: () => this.appConversation.nextLogEntryId()
    });
  }

  private syncAuthState(): void {
    this.authRequired = this.appAuth.authRequired;
    this.authChecking = this.appAuth.authChecking;
    this.authUser = this.appAuth.authUser;
    this.userMenuOpen = this.appAuth.userMenuOpen;
    this.availableTrips = this.appAuth.availableTrips;
  }

  // --- Global keyboard handler ---
  private handleGlobalKeyDown = (event: KeyboardEvent) => {
    if (event.defaultPrevented || event.repeat) {
      return;
    }
    if (event.key !== "Delete") {
      return;
    }
    if (this.isEditableKeyTarget(event)) {
      return;
    }
    const focusedUid = panelFocus.activityUid;
    if (!focusedUid) {
      return;
    }
    event.preventDefault();
    void this.submitCommand(`/delete uid="${focusedUid}"`, { skipChat: true });
  };

  static styles = [
    authStyles,
    css`
      :host {
        display: block;
        min-height: 100vh;
        font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
        color: #0f172a;
        background: #f8fafc;
      }

      .layout {
        display: flex;
        height: 100vh;
        gap: 1rem;
        padding: 1rem;
        box-sizing: border-box;
      }

      .panel {
        border: 1px solid #cbd5f5;
        border-radius: 8px;
        background: #ffffff;
        box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08);
        padding: 1rem;
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
        min-height: 0;
      }

      .panel-left {
        width: 420px;
        flex: 0 0 420px;
      }

      .panel-middle {
        flex: 1;
        display: flex;
        flex-direction: column;
        gap: 1rem;
        min-height: 0;
      }

      .panel-middle-top,
      .panel-middle-bottom {
        flex: 1;
        min-height: 0;
      }

      .panel-middle-top,
      .panel-middle-bottom {
        display: flex;
        flex-direction: column;
      }

      .panel-middle-top panel-day,
      .panel-middle-bottom panel-activity {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      .panel-right {
        flex: 1;
        margin-top: var(--panel-right-offset, 18px);
      }
    `
  ];

  render() {
    // Show loading while checking auth
    if (this.authChecking) {
      return html`<div class="auth-loading">Loading...</div>`;
    }

    // Show login form if auth required and not logged in
    if (this.authRequired && !this.authUser) {
      return this.appAuth.renderLogin();
    }

    return html`
      <div class="layout">
        ${this.appAuth.renderUserMenu()}
        <section class="panel panel-left">
          <panel-plan
            .title=${this.planTitle}
            .lines=${this.planLines}
            .trips=${this.availableTrips}
            .focusedKey=${this.__focusedDate}
            .incomingActivityDrag=${this.dayDragPlanState}
            @plan-date-focused=${this.handlePlanDateFocused}
            @plan-date-move=${this.handlePlanDateMove}
            @plan-date-toggle-mark=${this.handlePlanDateToggleMark}
            @plan-date-range-mark=${this.handlePlanDateRangeMark}
            @plan-trip-select=${this.handlePlanTripSelect}
          ></panel-plan>
        </section>
        <section class="panel-middle">
          <div class="panel panel-middle-top">
            <panel-day
              .title=${this.dayTitle}
              .items=${this.dayItems}
              .focusedUid=${this.__focusedUid}
              .flightCount=${this.dayFlightCount}
              .flightBooked=${this.dayFlightBooked}
              .hasRentalCar=${this.dayHasRentalCar}
              .rentalCarBooked=${this.dayRentalCarBooked}
              .lodgingStatus=${this.dayLodgingStatus}
              .lodgingCity=${this.dayLodgingCity}
              .mealCount=${this.dayMealCount}
              .mealsNeedingReservation=${this.dayMealsNeedingReservation}
              .hasDateMismatchIssue=${this.dayHasDateMismatchIssue}
              .mismatchedUids=${this.dayMismatchedUids}
              .issueNoTransportToLodging=${this.dayIssueNoTransportToLodging}
              .issueNoTransportToFlight=${this.dayIssueNoTransportToFlight}
              .alarmUids=${this.activityUidsWithAlarms}
              @day-activity-hover=${this.handleDayActivityHover}
              @day-activity-focus=${this.handleDayActivityFocus}
              @day-activity-drag-state=${this.handleDayActivityDragState}
              @day-activity-move=${this.handleDayActivityMove}
              @day-activity-move-date=${this.handleDayActivityMoveDate}
              @day-activity-toggle-mark=${this.handleDayActivityToggleMark}
              @day-activity-range-mark=${this.handleDayActivityRangeMark}
              @day-activity-delete=${this.handleDayActivityDelete}
              @panel-day-alarm-toggle=${this.handleAlarmToggle}
            ></panel-day>
          </div>
          <div class="panel panel-middle-bottom">
            <panel-activity
              .activity=${this.__hoveredActivity}
              .canCreate=${Boolean(this.tripModel)}
              .countries=${this.tripModel?.countries ?? []}
              .marked=${this.markedActivityIds.length > 0 && this.markedActivitySet.has(this.__hoveredActivity?.uid ?? "")}
              .hasAlarm=${this.activityUidsWithAlarms.has(this.__hoveredActivity?.uid ?? "")}
              @panel-activity-create=${this.handleActivityCreate}
              @panel-activity-alarm-toggle=${this.handleAlarmToggle}
              @panel-date-link-click=${this.handlePanelDateLink}
            ></panel-activity>
          </div>
        </section>
        <section class="panel panel-right">
          <panel-detail
            .messages=${this.messages}
            .serverBusy=${this.sending}
            .activities=${this.tripModel?.activities ?? []}
            @panel-detail-submit=${this.handlePanelSubmit}
            @panel-detail-stop=${this.handlePanelStop}
            @panel-detail-link=${this.handlePanelDetailSelect}
            @panel-date-link-click=${this.handlePanelDateLink}
            @panel-command-activity-select=${this.handlePanelCommandActivitySelect}
          ></panel-detail>
        </section>
      </div>
    `;
  }

  // --- Lifecycle ---

  connectedCallback() {
    super.connectedCallback();

    this.appAuth.init();

    // Close user menu when clicking outside
    document.addEventListener("click", this.handleDocumentClick);
    window.addEventListener("keydown", this.handleGlobalKeyDown);

    // Start auth check
    void this.appAuth.checkAuth();

    // Setup focus system
    const lookupActivityByUidFn = (uid: string | null) =>
      this.tripModel?.activities.find((activity) => activity.uid === uid) ?? null;
    const onFocusedDateChangeFn = () => this.onFocusedDateChange(this.planLines);
    panelFocus.attachHost(this, lookupActivityByUidFn, onFocusedDateChangeFn);

    // Setup marks
    this.applyMarkedActivities(panelMarks.getMarked());
    this.applyMarkedDates(panelDateMarks.getMarked());
    this.activityMarksUnsubscribe = panelMarks.subscribe((uids) => this.applyMarkedActivities(uids));
    this.dateMarksUnsubscribe = panelDateMarks.subscribe((dates) => this.applyMarkedDates(dates));

    void this.appCommands.announceChatConnection();
  }

  disconnectedCallback() {
    this.appAuth.destroy();
    document.removeEventListener("click", this.handleDocumentClick);
    window.removeEventListener("keydown", this.handleGlobalKeyDown);

    if (this.activityMarksUnsubscribe) {
      this.activityMarksUnsubscribe();
      this.activityMarksUnsubscribe = null;
    }
    if (this.dateMarksUnsubscribe) {
      this.dateMarksUnsubscribe();
      this.dateMarksUnsubscribe = null;
    }
    panelFocus.detachHost(this);
    super.disconnectedCallback();
  }

  // --- Document click handler (for user menu) ---

  private handleDocumentClick = (e: Event) => {
    const authBar = this.shadowRoot?.querySelector('.auth-bar') ?? null;
    this.appAuth.closeUserMenuIfOpen(e, authBar);
  };

  // --- Focus host interface ---

  __getTripId(): string | null {
    return this.currentTripId;
  }

  // --- Command submission (delegated) ---

  private async submitCommand(
    text: string,
    options?: { skipChat?: boolean; showSearchResults?: boolean; suppressEcho?: boolean }
  ) {
    return this.appCommands.submitCommand(text, options);
  }

  // --- Panel event handlers ---

  private handlePanelSubmit(event: CustomEvent<{ text: string }>) {
    const text = event.detail?.text?.trim();
    if (!text) {
      return;
    }
    void this.submitCommand(text);
  }

  private handlePanelStop() {
    this.appCommands.requestStop();
  }

  // --- Trip model management ---

  private rememberTripModel(model: TripModel) {
    this.tripModel = model;
    const newTripId = model.tripId?.trim() || model.tripName?.trim();
    if (newTripId) {
      const switchingTrip = newTripId !== this.currentTripId;
      this.currentTripId = newTripId;
      if (switchingTrip) {
        panelFocus.date = null;
        panelFocus.hoveredActivity = null;
        const storedUid = loadFocusedActivityUid(newTripId);
        panelFocus.activityUid = storedUid;
        this.appConversation.resetConversationLog();
        void this.appConversation.loadConversationHistory(newTripId);
      }
    }
    this.updatePanels(model);

    // Handle pending edited UID
    if (this.appCommands.pendingEditedUid) {
      panelFocus.activityUid = this.appCommands.pendingEditedUid;
      this.appCommands.pendingEditedUid = null;
    }

    // Handle pending new activity detection
    if (this.appCommands.pendingNewActivityPrevUids) {
      const previous = this.appCommands.pendingNewActivityPrevUids;
      this.appCommands.pendingNewActivityPrevUids = null;

      let newestActivity: Activity | null = null;
      for (const activity of model.activities) {
        if (activity.uid && !previous.has(activity.uid)) {
          newestActivity = activity;
        }
      }

      if (newestActivity) {
        if (newestActivity.date) {
          panelFocus.date = newestActivity.date;
        }
        panelFocus.activityUid = newestActivity.uid;
      }
    }
  }

  private updatePanels(model: TripModel) {
    this.planTitle = this.derivePlanTitle(model);
    this.refreshPlanLines(model.activities, model.daySummaries);

    // Update available trips from cache
    this.appAuth.refreshAvailableTrips();
    this.availableTrips = this.appAuth.availableTrips;

    // Build set of activity UIDs that have alarms
    const alarmActivityUids = new Set<string>();
    if (model.alarms) {
      for (const alarm of model.alarms) {
        if (alarm.activityUid && alarm.enabled) {
          alarmActivityUids.add(alarm.activityUid);
        }
      }
    }
    this.activityUidsWithAlarms = alarmActivityUids;

    if (!panelFocus.date) {
      panelFocus.date = loadFocusedDate(this.currentTripId);
    }
  }

  private refreshPlanLines(activities: Activity[], daySummaries?: TripModel["daySummaries"]) {
    const lines = buildPlanLines(activities, this.markedActivitySet, this.markedDateSet, daySummaries);
    this.planLines = lines;
    planDayRegistry.updateFromPlanLines(lines);
    this.onFocusedDateChange(lines);
  }

  private derivePlanTitle(model?: TripModel | null) {
    if (!model) {
      return "Untitled Trip";
    }
    return model.tripId?.trim() || model.tripName?.trim() || "Untitled Trip";
  }

  // --- Auto restore ---

  private tryAutoRestoreTrip() {
    if (this.attemptedAutoRestore) {
      return;
    }
    this.attemptedAutoRestore = true;
    const tripId = this.currentTripId;
    if (!tripId) {
      return;
    }
    panelFocus.activityUid = loadFocusedActivityUid(tripId);
    void this.submitCommand(`/trip ${tripId}`, { skipChat: true });
  }

  // --- Plan panel handlers ---

  private handlePlanDateFocused(event: CustomEvent<{ line: PlanLine }>) {
    const line = event.detail?.line;
    if (!line || line.kind !== "dated") {
      return;
    }
    panelFocus.date = line.date;

    const matchesExistingFocus = panelFocus.activityUid
      ? line.activities.some((activity) => activity.uid === panelFocus.activityUid)
      : false;

    if (matchesExistingFocus) {
      return;
    }

    const fallbackUid = line.primaryActivityUid ?? line.activities[0]?.uid ?? null;
    panelFocus.activityUid = fallbackUid;
    panelFocus.hoveredActivity = fallbackUid
      ? line.activities.find((activity) => activity.uid === fallbackUid) ?? null
      : null;
  }

  private handlePlanDateMove(event: CustomEvent<{ fromKey: string; toKey: string }>) {
    const { fromKey, toKey } = event.detail;
    if (!fromKey || !toKey || fromKey === toKey) {
      return;
    }
    const targetLine = this.planLines.find(
      (line): line is Extract<PlanLine, { kind: "dated" }> => line.kind === "dated" && line.date === toKey
    );
    if (targetLine) {
      panelFocus.date = targetLine.date;
    } else {
      panelFocus.date = toKey;
    }
    void this.submitCommand(`/moveday from="${fromKey}" to="${toKey}"`, { skipChat: true });
  }

  private handlePlanDateRangeMark(event: CustomEvent<{ date: string }>) {
    const targetDate = event.detail?.date;
    if (!targetDate) {
      return;
    }

    const lines = this.planLines;
    if (!lines.length) {
      return;
    }

    const targetIndex = lines.findIndex((line) => line.kind === "dated" && line.date === targetDate);
    if (targetIndex === -1) {
      return;
    }

    const anchorDate = panelFocus.date;
    if (!anchorDate) {
      return;
    }

    const anchorIndex = lines.findIndex((line) => line.kind === "dated" && line.date === anchorDate);
    if (anchorIndex === -1) {
      return;
    }

    const start = Math.min(anchorIndex, targetIndex);
    const end = Math.max(anchorIndex, targetIndex);

    let allMarked = true;
    for (let i = start; i <= end; i += 1) {
      const line = lines[i];
      if (!line || line.kind !== "dated" || !this.markedDateSet.has(line.date)) {
        allMarked = false;
        break;
      }
    }

    for (let i = start; i <= end; i += 1) {
      const line = lines[i];
      if (!line || line.kind !== "dated") {
        continue;
      }
      if (allMarked) {
        panelDateMarks.unmark(line.date);
      } else {
        panelDateMarks.mark(line.date);
      }
    }

    panelFocus.date = targetDate;
  }

  private handlePlanTripSelect(event: CustomEvent<{ tripId: string }>) {
    const tripId = event.detail?.tripId?.trim();
    if (!tripId) {
      return;
    }
    void this.submitCommand(`/trip ${tripId}`, { skipChat: true });
  }

  private handlePlanDateToggleMark(event: CustomEvent<{ date: string; mark: boolean }>) {
    const date = event.detail?.date?.trim();
    if (!date) {
      return;
    }
    if (event.detail?.mark) {
      panelDateMarks.mark(date);
    } else {
      panelDateMarks.unmark(date);
    }
  }

  // --- Day panel state update ---

  private onFocusedDateChange(lines: PlanLine[]) {
    const existing = !panelFocus.date ? null : lines.find(
      (line): line is Extract<PlanLine, { kind: "dated" }> =>
        line.kind === "dated" && line.date === panelFocus.date
    );

    this.dayTitle = existing ? existing.fullDisplayDate : "Day";
    this.dayItems = existing
      ? buildDayItems(existing.activities, describeActivity, this.markedActivitySet)
      : [];

    this.dayFlightCount = existing?.flightCount ?? 0;
    this.dayFlightBooked = existing?.flightBooked ?? false;
    this.dayHasRentalCar = existing?.hasRentalCar ?? false;
    this.dayRentalCarBooked = existing?.rentalCarBooked ?? false;
    this.dayLodgingStatus = existing?.lodgingStatus ?? "none";
    this.dayLodgingCity = existing?.lodgingCity;
    this.dayMealCount = existing?.mealCount ?? 0;
    this.dayMealsNeedingReservation = existing?.mealsNeedingReservation ?? 0;
    this.dayHasDateMismatchIssue = existing?.hasDateMismatchIssue ?? false;
    this.dayIssueNoTransportToLodging = existing?.issueNoTransportToLodging ?? false;
    this.dayIssueNoTransportToFlight = existing?.issueNoTransportToFlight ?? false;

    const daySummary = existing && this.tripModel?.daySummaries?.find(s => s.date === existing.date);
    const mismatchStr = daySummary?.issueActivitiesWithMismatchedBookingDates ?? "";
    this.dayMismatchedUids = new Set(mismatchStr.split(/\s+/).filter(Boolean));
  }

  // --- Marks handling ---

  private applyMarkedActivities(uids: string[]) {
    const nextActivityList = Array.isArray(uids) ? [...uids] : [];
    const changed =
      nextActivityList.length !== this.markedActivityIds.length ||
      nextActivityList.some((uid, index) => uid !== this.markedActivityIds[index]);

    if (changed) {
      this.markedActivityIds = nextActivityList;
      this.markedActivitySet = new Set(nextActivityList);
      this.refreshMarkedViews();
    }
  }

  private applyMarkedDates(dates: string[]) {
    const nextDateList = Array.isArray(dates) ? [...dates] : [];
    const changed =
      nextDateList.length !== this.markedDateKeys.length ||
      nextDateList.some((date, index) => date !== this.markedDateKeys[index]);

    if (changed) {
      this.markedDateKeys = nextDateList;
      this.markedDateSet = new Set(nextDateList);
      this.refreshMarkedViews();
    }
  }

  private refreshMarkedViews() {
    if (this.tripModel) {
      this.refreshPlanLines(this.tripModel.activities, this.tripModel.daySummaries);
    } else {
      this.onFocusedDateChange(this.planLines);
    }
  }

  // --- Day panel handlers ---

  private handleDayActivityHover(event: CustomEvent<{ activity: Activity | null }>) {
    panelFocus.hoveredActivity = event.detail.activity ?? null;
  }

  private handleDayActivityFocus(event: CustomEvent<{ activity: Activity }>) {
    panelFocus.activityUid = event.detail.activity.uid;
  }

  private handleDayActivityRangeMark(event: CustomEvent<{ uid: string; index: number }>) {
    const uid = event.detail?.uid?.trim();
    const index = event.detail?.index ?? -1;
    if (!uid || index < 0) {
      return;
    }
    const items = this.dayItems;
    if (!items.length) {
      return;
    }
    const anchorUid = panelFocus.activityUid;
    if (!anchorUid) {
      return;
    }

    const anchorIndex = items.findIndex((entry) => entry.activity?.uid === anchorUid);
    if (anchorIndex === -1) {
      return;
    }
    const start = Math.min(anchorIndex, index);
    const end = Math.max(anchorIndex, index);

    let allMarked = true;
    for (let i = start; i <= end; i += 1) {
      const activityUid = items[i]?.activity?.uid;
      if (!activityUid || !this.markedActivitySet.has(activityUid)) {
        allMarked = false;
        break;
      }
    }

    for (let i = start; i <= end; i += 1) {
      const activityUid = items[i]?.activity?.uid;
      if (!activityUid) {
        continue;
      }
      if (allMarked) {
        panelMarks.unmark(activityUid);
      } else {
        panelMarks.mark(activityUid);
      }
    }

    panelFocus.activityUid = uid;
  }

  private handleDayActivityToggleMark(event: CustomEvent<{ uid: string; mark: boolean }>) {
    const uid = event.detail?.uid?.trim();
    if (!uid) {
      return;
    }
    if (event.detail?.mark) {
      panelMarks.mark(uid);
    } else {
      panelMarks.unmark(uid);
    }
  }

  private handleDayActivityDelete(event: CustomEvent<{ uid: string }>) {
    const uid = event.detail?.uid?.trim();
    if (!uid) {
      return;
    }
    void this.submitCommand(`/delete uid="${uid}"`, { skipChat: true });
  }

  private handleAlarmToggle(event: CustomEvent<{ activityUid: string; hasAlarm: boolean }>) {
    const activityUid = event.detail?.activityUid?.trim();
    if (!activityUid) {
      return;
    }
    if (event.detail.hasAlarm) {
      const alarm = this.tripModel?.alarms?.find(a => a.activityUid === activityUid);
      if (alarm?.uid) {
        void this.submitCommand(`/deletealarm uid="${alarm.uid}"`, { skipChat: true });
      }
    } else {
      void this.submitCommand(`/setalarm activityUid="${activityUid}"`, { skipChat: true });
    }
  }

  private handleDayActivityDragState(event: CustomEvent<{ active: boolean; uid?: string; date?: string | null }>) {
    if (!event.detail?.active) {
      this.dayDragPlanState = null;
      return;
    }
    const uid = event.detail.uid;
    if (!uid) {
      this.dayDragPlanState = null;
      return;
    }
    this.dayDragPlanState = { uid, date: event.detail.date ?? null };
  }

  private handleDayActivityMove(event: CustomEvent<{ uid: string; time: string }>) {
    const uid = event.detail.uid?.trim();
    const time = event.detail.time?.trim();
    if (!uid || !time) {
      return;
    }
    panelFocus.activityUid = uid;
    void this.submitCommand(`/edit ${uid} time="${time}"`, { skipChat: true });
  }

  private handleDayActivityMoveDate(event: CustomEvent<{ uid: string; date: string }>) {
    const uid = event.detail.uid?.trim();
    const date = event.detail.date?.trim();
    if (!uid || !date) {
      return;
    }
    this.dayDragPlanState = null;
    const targetLine = this.planLines.find(
      (line): line is Extract<PlanLine, { kind: "dated" }> => line.kind === "dated" && line.date === date
    );
    panelFocus.date = targetLine ? targetLine.date : date;
    panelFocus.activityUid = uid;
    void this.submitCommand(`/edit ${uid} date="${date}"`, { skipChat: true });
  }

  // --- Activity panel handlers ---

  private handleActivityCreate() {
    if (!this.tripModel) {
      return;
    }
    const parts = [
      `/add ${DEFAULT_ACTIVITY_TO_CREATE}`,
      'name="New Activity"'
    ];
    if (panelFocus.date) {
      parts.push(`date="${panelFocus.date}"`);
    }
    const derivedTime = this.deriveNextActivityTime();
    if (derivedTime) {
      parts.push(`time="${derivedTime}"`);
    }
    this.appCommands.pendingNewActivityPrevUids = this.captureCurrentActivityUids();
    void this.submitCommand(parts.join(" "), { skipChat: true });
  }

  private deriveNextActivityTime(): string | null {
    const time = panelFocus.activity?.time?.trim();
    if (!time) {
      return null;
    }
    const minutes = parseTimeToMinutes(time);
    if (minutes === null) {
      return time;
    }
    const next = minutes + 60;
    if (next >= 24 * 60) {
      return minutesToTime(minutes);
    }
    return minutesToTime(next);
  }

  private captureCurrentActivityUids(): Set<string> {
    const set = new Set<string>();
    for (const activity of this.tripModel?.activities ?? []) {
      if (activity.uid) {
        set.add(activity.uid);
      }
    }
    return set;
  }

  // --- Detail panel handlers ---

  private handlePanelDetailSelect(event: CustomEvent<{ type: "activity" | "date"; value: string }>) {
    const type = event.detail?.type;
    const value = event.detail?.value?.trim();
    if (!type || !value) {
      return;
    }

    if (type === "activity") {
      panelFocus.activityUid = value;
      const activity = this.tripModel?.activities.find((entry) => entry.uid === value) ?? null;
      if (activity?.date) {
        panelFocus.date = activity.date;
      }
      panelFocus.hoveredActivity = activity;
      return;
    }

    if (type === "date") {
      panelFocus.date = normalizeUserDate(value) ?? value;
    }
  }

  private handlePanelDateLink(event: CustomEvent<{ date: string }>) {
    const rawDate = event.detail?.date?.trim();
    if (!rawDate) {
      return;
    }
    const normalized = normalizeUserDate(rawDate) ?? rawDate;
    panelFocus.date = normalized;
  }

  private handlePanelCommandActivitySelect(event: CustomEvent<{ uid?: string }>) {
    const uid = event.detail?.uid;
    if (!uid) {
      return;
    }
    panelFocus.activityUid = uid;
    const activity = this.tripModel?.activities.find((entry) => entry.uid === uid) ?? null;
    if (activity?.date) {
      panelFocus.date = activity.date;
    }
    panelFocus.hoveredActivity = activity;
  }

  // --- Helpers ---

  private isEditableKeyTarget(event: KeyboardEvent): boolean {
    const path = typeof event.composedPath === "function" ? event.composedPath() : [];
    if (path.length) {
      for (const node of path) {
        if (!(node instanceof HTMLElement)) {
          continue;
        }
        if (node.tagName === "INPUT" || node.tagName === "TEXTAREA" || node.isContentEditable) {
          return true;
        }
      }
      return false;
    }
    const target = event.target;
    return target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
  }
}

// --- Utility functions ---

function parseTimeToMinutes(value: string): number | null {
  const match = value.match(/^([0-1]?\d|2[0-3]):?(\d{2})?$/);
  if (!match) {
    return null;
  }
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? "00");
  return hours * 60 + minutes;
}

function minutesToTime(minutes: number): string {
  const hrs = Math.floor(minutes / 60)
    .toString()
    .padStart(2, "0");
  const mins = (minutes % 60).toString().padStart(2, "0");
  return `${hrs}:${mins}`;
}
