import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { Activity, PlanLine, TripModel } from "./types";
import { processUserCommand, extractSlashCommandLines } from "./commandUx";
import type { CommandProcessingResult } from "./commandUx";
import { buildPlanLines, describeActivity } from "./view/view-plan";
import type { DayEntry } from "./view/view-day";
import { buildDayItems } from "./view/view-day";
import { panelFocus } from "./focus";
import { panelMarks, panelDateMarks } from "./panelMarks";
import { planDayRegistry } from "./planDayRegistry";
import { normalizeUserDate } from "./ux-date";
import type { PanelDetailLogEntry } from "./components/panel-detail";
import {
  saveLastTripId,
  loadLastTripId,
  saveFocusedDate,
  loadFocusedDate,
  saveFocusedActivityUid,
  loadFocusedActivityUid,
  clearFocusedActivityUid
} from "./storage";
import { checkAuthRequired, tryAutoLogin, login, logout, authFetch } from "./auth";
import "./components/panel-plan";
import "./components/panel-day";
import "./components/panel-activity";
import "./components/panel-detail";

const DEFAULT_ACTIVITY_TO_CREATE = "visit";

@customElement("trip-app")
export class TripApp extends LitElement {
  @state() private messages: PanelDetailLogEntry[] = [];
  @state() private sending = false;
  @state() private tripModel: TripModel | null = null;
  @state() private planTitle = "Untitled Trip";
  @state() private planLines: PlanLine[] = [];
  @state() private currentTripId = "demo";
  @state() __focusedUid: string | null = null;
  @state() __focusedDate: string | null = null;
  @state() __hoveredActivity: Activity | null = null;
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
  @state() private dayDragPlanState: { uid: string; date: string | null } | null = null;
  @state() private markedActivityIds: string[] = [];
  @state() private markedDateKeys: string[] = [];
  // Auth state
  @state() private authRequired = false;
  @state() private authChecking = true;
  @state() private authUser: string | null = null;
  @state() private authError: string | null = null;
  private attemptedAutoRestore = false;
  private pendingNewActivityPrevUids: Set<string> | null = null;
  private logEntryCounter = 0;
  private pendingEditedUid: string | null = null;
  private conversationHistoryRequestId = 0;
  private markedActivitySet: Set<string> = new Set();
  private markedDateSet: Set<string> = new Set();
  private activityMarksUnsubscribe: (() => void) | null = null;
  private dateMarksUnsubscribe: (() => void) | null = null;
  private chatbotStopRequested = false;
  
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      font-family: "Segoe UI", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
      color: #0f172a;
      background: #f8fafc;
    }

    .auth-loading {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      font-size: 1.2rem;
      color: #64748b;
    }

    .auth-container {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
    }

    .auth-form {
      background: white;
      padding: 2rem;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      width: 320px;
    }

    .auth-form h2 {
      margin: 0 0 1.5rem 0;
      color: #1e293b;
    }

    .auth-form label {
      display: block;
      margin-bottom: 0.5rem;
      color: #475569;
      font-size: 0.875rem;
    }

    .auth-form input {
      width: 100%;
      padding: 0.75rem;
      margin-bottom: 1rem;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      font-size: 1rem;
      box-sizing: border-box;
    }

    .auth-form input:focus {
      outline: none;
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
    }

    .auth-form button {
      width: 100%;
      padding: 0.75rem;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 4px;
      font-size: 1rem;
      cursor: pointer;
    }

    .auth-form button:hover {
      background: #2563eb;
    }

    .auth-error {
      color: #dc2626;
      margin-bottom: 1rem;
      padding: 0.5rem;
      background: #fef2f2;
      border-radius: 4px;
      font-size: 0.875rem;
    }

    .auth-bar {
      position: absolute;
      top: 0.5rem;
      right: 1rem;
      display: flex;
      align-items: center;
      gap: 1rem;
      font-size: 0.875rem;
      color: #64748b;
      z-index: 100;
    }

    .auth-bar button {
      padding: 0.25rem 0.75rem;
      background: #f1f5f9;
      border: 1px solid #cbd5e1;
      border-radius: 4px;
      cursor: pointer;
      font-size: 0.75rem;
    }

    .auth-bar button:hover {
      background: #e2e8f0;
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
    }
  `;

  private renderLogin() {
    return html`
      <div class="auth-container">
        <form class="auth-form" @submit=${this.handleLoginSubmit}>
          <h2>Travelr Login</h2>
          ${this.authError ? html`<div class="auth-error">${this.authError}</div>` : ""}
          <label for="user">Username</label>
          <input type="text" id="user" name="user" required autocomplete="username" />
          <label for="password">Password</label>
          <input type="password" id="password" name="password" required autocomplete="current-password" />
          <button type="submit">Login</button>
        </form>
      </div>
    `;
  }

  private async handleLoginSubmit(e: Event) {
    e.preventDefault();
    const form = e.target as HTMLFormElement;
    const formData = new FormData(form);
    const user = formData.get("user") as string;
    const password = formData.get("password") as string;
    
    this.authError = null;
    const result = await login(user, password);
    
    if (result.ok) {
      this.authUser = user;
    } else {
      this.authError = result.error || "Login failed";
    }
  }

  render() {
    // Show loading while checking auth
    if (this.authChecking) {
      return html`<div class="auth-loading">Loading...</div>`;
    }
    
    // Show login form if auth required and not logged in
    if (this.authRequired && !this.authUser) {
      return this.renderLogin();
    }
    
    return html`
      <div class="layout">
        ${this.authUser ? html`
          <div class="auth-bar">
            <span>Logged in as <strong>${this.authUser}</strong></span>
            <button @click=${this.handleLogout}>Logout</button>
          </div>
        ` : ""}
        <section class="panel panel-left">
          <panel-plan
            .title=${this.planTitle}
            .lines=${this.planLines}
            .focusedKey=${this.__focusedDate}
            .incomingActivityDrag=${this.dayDragPlanState}
            @plan-date-focused=${this.handlePlanDateFocused}
            @plan-date-move=${this.handlePlanDateMove}
            @plan-date-toggle-mark=${this.handlePlanDateToggleMark}
            @plan-date-range-mark=${this.handlePlanDateRangeMark}
          ></panel-plan>
        </section>
        <section class="panel panel-middle">
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
              .issueNoTransportToLodging=${this.dayIssueNoTransportToLodging}
              .issueNoTransportToFlight=${this.dayIssueNoTransportToFlight}
              .mismatchedUids=${this.dayMismatchedUids}
              @day-activity-hover=${this.handleDayActivityHover}
              @day-activity-focus=${this.handleDayActivityFocus}
              @day-activity-drag-state=${this.handleDayActivityDragState}
              @day-activity-move=${this.handleDayActivityMove}
              @day-activity-move-date=${this.handleDayActivityMoveDate}
              @day-activity-toggle-mark=${this.handleDayActivityToggleMark}
              @day-activity-range-mark=${this.handleDayActivityRangeMark}
            ></panel-day>
          </div>
          <div class="panel panel-middle-bottom">
            <panel-activity
              .activity=${this.__hoveredActivity}
              .canCreate=${Boolean(this.tripModel)}
              .countries=${this.tripModel?.countries ?? []}
              .marked=${this.markedActivityIds.length > 0 && this.markedActivitySet.has(this.__hoveredActivity?.uid ?? "")}
              @panel-activity-create=${this.handleActivityCreate}
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

  __getTripId(): string
  {
	return this.currentTripId;
  }

  private appendMessage(message: string, options?: { isUser?: boolean; pending?: boolean }): string {
    const id = this.nextLogEntryId();
    this.appendLogEntry({
      id,
      kind: "text",
      text: message,
      isUser: options?.isUser ?? false,
      pending: options?.pending ?? false
    });
    return id;
  }

  private updateMessage(id: string, text: string, options?: { pending?: boolean }): void {
    this.messages = this.messages.map((entry) => {
      if (entry.id !== id || entry.kind !== "text") {
        return entry;
      }
      return { ...entry, text, pending: options?.pending ?? false };
    });
  }

  private appendLogEntry(entry: PanelDetailLogEntry) {
    this.messages = [...this.messages, entry];
  }

  private nextLogEntryId(): string {
    this.logEntryCounter += 1;
    return `log-${this.logEntryCounter}`;
  }

  private async handlePanelSubmit(event: CustomEvent<{ text: string }>) {
    await this.submitCommand(event.detail.text);
  }

  private handlePanelStop() {
    this.chatbotStopRequested = true;
    this.appendMessage("ℹ Stop requested...");
  }

  connectedCallback() {
    super.connectedCallback();
    // Check auth before doing anything else
    this.checkAuth();
  let lookupActivityByUidFn = (uid:string | null) => this.tripModel?.activities.find((activity) => activity.uid === uid) ?? null;
  let onFocusedDateChangeFn = () => this.onFocusedDateChange(this.planLines);
	panelFocus.attachHost(
      this,
      lookupActivityByUidFn,
    onFocusedDateChangeFn  
    );
    this.applyMarkedActivities(panelMarks.getMarked());
    this.applyMarkedDates(panelDateMarks.getMarked());
    this.activityMarksUnsubscribe = panelMarks.subscribe((uids) => this.applyMarkedActivities(uids));
    this.dateMarksUnsubscribe = panelDateMarks.subscribe((dates) => this.applyMarkedDates(dates));
    this.tryAutoRestoreTrip();
    void this.loadConversationHistory(this.currentTripId);
    void this.announceChatConnection();
  }

  private async checkAuth() {
    this.authChecking = true;
    this.authError = null;
    
    // Check if auth is required
    this.authRequired = await checkAuthRequired();
    
    if (!this.authRequired) {
      this.authChecking = false;
      return;
    }
    
    // Try auto-login with cached auth key
    const auth = await tryAutoLogin();
    if (auth) {
      this.authUser = auth.user;
    }
    
    this.authChecking = false;
  }

  private async handleLogout() {
    await logout();
    this.authUser = null;
  }

  disconnectedCallback() {
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
  private rememberTripModel(model: TripModel) {
    this.tripModel = model;
    const newTripId = model.tripId?.trim() || model.tripName?.trim();
    if (newTripId) {
      const switchingTrip = newTripId !== this.currentTripId;
      this.currentTripId = newTripId;
      saveLastTripId(newTripId);
      if (switchingTrip) {
		panelFocus.date = null;
		panelFocus.hoveredActivity = null;
        const storedUid = loadFocusedActivityUid(newTripId);
        panelFocus.activityUid = storedUid;
        this.resetConversationLog();
        void this.loadConversationHistory(newTripId);
      }
    }
    this.updatePanels(model);

    if (this.pendingEditedUid) {
	  panelFocus.activityUid = this.pendingEditedUid;
      this.pendingEditedUid = null;
    }

    if (this.pendingNewActivityPrevUids) {
      const previous = this.pendingNewActivityPrevUids;
      this.pendingNewActivityPrevUids = null;

      // Detect any UID that did not exist before the /add block was sent. When multiple
      // activities are created in one shot, prefer the last one so focus follows the
      // most recent addition the chatbot made.
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

  private onFocusedDateChange(lines: PlanLine[]) {
    const existing = !panelFocus.date ? null : lines.find(
      (line): line is Extract<PlanLine, { kind: "dated" }> =>
        line.kind === "dated" && line.date === panelFocus.date
    );

    this.dayTitle = existing ? existing.fullDisplayDate : "Day";
    this.dayItems = existing
      ? buildDayItems(existing.activities, describeActivity, this.markedActivitySet)
      : [];

    // Update indicator state from the focused PlanLine
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

    // Get mismatched UIDs from day summary for activity-level issue indicators
    const daySummary = existing && this.tripModel?.daySummaries?.find(s => s.date === existing.date);
    const mismatchStr = daySummary?.issueActivitiesWithMismatchedBookingDates ?? "";
    this.dayMismatchedUids = new Set(mismatchStr.split(/\s+/).filter(Boolean));
  }

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
    this.pendingNewActivityPrevUids = this.captureCurrentActivityUids();
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

  private async submitCommand(
    text: string,
    options?: { skipChat?: boolean; showSearchResults?: boolean; suppressEcho?: boolean }
  ): Promise<CommandProcessingResult | null> {
    const trimmed = text.trim();
    if (!trimmed) {
      return null;
    }

    this.pendingEditedUid = this.extractLastEditedUid(text);
    if (this.containsAddCommand(text)) {
      this.pendingNewActivityPrevUids = this.captureCurrentActivityUids();
    }

    const shouldShowSearchResults = options?.showSearchResults ?? true;
    
    // Reset stop flag when starting a new command
    this.chatbotStopRequested = false;
    
    const result = await processUserCommand({
      text,
      currentTripId: this.currentTripId,
      focusSummary: panelFocus.describeFocus(),
      markedActivities: this.markedActivityIds,
      markedDates: this.markedDateKeys,
      appendMessage: (message, meta) => this.appendMessage(message, meta),
      updateMessage: (id, newText, meta) => this.updateMessage(id, newText, meta),
      setSending: (sending) => {
        this.sending = sending;
      },
      rememberTripModel: (model) => this.rememberTripModel(model),
      updateMarks: (activities, dates) => {
        if (activities !== undefined) panelMarks.setAll(activities);
        if (dates !== undefined) panelDateMarks.setAll(dates);
      },
      shouldStop: () => this.chatbotStopRequested,
      echoCommands: !(options?.suppressEcho ?? false)
    });

    if (result.payload?.searchResults) {
      const queryText = result.payload.query ?? "(unknown query)";
      const snippets = result.payload.searchResults;
      const humanSummary = `Search "${queryText}" (${snippets.length})`;
      if (shouldShowSearchResults) {
        this.appendLogEntry({
          id: this.nextLogEntryId(),
          kind: "search",
          summary: humanSummary,
          snippets
        });
      }
    }

    return result;
  }

  private containsAddCommand(text: string): boolean {
    const commands = extractSlashCommandLines(text);
    return commands.some((line) => line.trimStart().toLowerCase().startsWith("/add"));
  }

  private async announceChatConnection(): Promise<void> {
    try {
      const response = await authFetch("/api/gpt/health");
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        model?: string;
        error?: string;
      };
      if (response.ok && payload?.ok) {
        const model = payload.model ?? "unknown";
        const message = payload.message ?? `ChatGPT ${model} connected.`;
        this.appendMessage(message);
      } else {
        const detail = payload?.error ?? response.statusText ?? "Failed";
        this.appendMessage(`ChatGPT connection failed: ${detail}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendMessage(`ChatGPT connection failed: ${message}`);
    }
  }

  private tryAutoRestoreTrip() {
    if (this.attemptedAutoRestore) {
      return;
    }
    this.attemptedAutoRestore = true;
    const storedTripId = loadLastTripId();
    if (!storedTripId) {
      return;
    }
    this.currentTripId = storedTripId;
	panelFocus.activityUid = loadFocusedActivityUid(storedTripId);
    void this.submitCommand(`/trip ${storedTripId}`, { skipChat: true });
  }

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
  private async loadConversationHistory(tripId: string | null): Promise<void> {
    const requestId = ++this.conversationHistoryRequestId;
    if (!tripId) {
      this.resetConversationLog();
      return;
    }

    try {
      const response = await authFetch(`/api/trip/${encodeURIComponent(tripId)}/conversation`);
      if (requestId !== this.conversationHistoryRequestId) {
        return;
      }
      if (!response.ok) {
        this.resetConversationLog();
        return;
      }
      const payload = (await response.json().catch(() => ({}))) as { history?: string };
      if (requestId !== this.conversationHistoryRequestId) {
        return;
      }
      const historyText = typeof payload.history === "string" ? payload.history : "";
      this.applyConversationHistory(historyText);
    } catch (error) {
      if (requestId !== this.conversationHistoryRequestId) {
        return;
      }
      console.error("Failed to load conversation history", error);
      this.resetConversationLog();
    }
  }

  private applyConversationHistory(history: string) {
    const normalized = history.replace(/\r\n/g, "\n").trim();
    if (!normalized) {
      this.resetConversationLog();
      return;
    }
    const restored = this.parseConversationHistoryForDisplay(normalized);
    this.logEntryCounter = restored.length;
    this.messages = restored;
  }

  private parseConversationHistoryForDisplay(history: string): PanelDetailLogEntry[] {
    const lines = history.split("\n");
    const entries: Array<{ text: string; isUser: boolean }> = [];
    let current: { text: string; isUser: boolean } | null = null;
    let skippingHidden = false;

    const commit = () => {
      if (current) {
        entries.push(current);
        current = null;
      }
    };

    for (const rawLine of lines) {
      const line = rawLine.replace(/\r$/, "");
      if (!line.length) {
        if (current && !skippingHidden) {
          current.text += "\n";
        }
        continue;
      }

      const trimmed = line.trimStart();
      const isBoundary = this.looksLikeHistoryBoundary(trimmed);

      if (skippingHidden) {
        if (isBoundary) {
          skippingHidden = false;
        } else {
          continue;
        }
      }

      if (this.isHiddenHistoryBoundary(trimmed)) {
        skippingHidden = true;
        commit();
        continue;
      }

      if (isBoundary) {
        commit();
        current = this.buildHistoryEntryFromLine(line);
        continue;
      }

      if (!current) {
        current = this.buildHistoryEntryFromLine(line);
        continue;
      }

      current.text += `\n${line}`;
    }

    if (current && !skippingHidden) {
      entries.push(current);
    }

    return entries.map((entry, index) => ({
      id: `log-${index + 1}`,
      kind: "text",
      text: entry.text,
      isUser: entry.isUser
    }));
  }

  private looksLikeHistoryBoundary(line: string): boolean {
    return /^User:/i.test(line)
      || /^GPT\b/i.test(line)
      || /^ChatGPT\b/i.test(line)
      || /^[✓✗ℹ]/.test(line)
      || /^Network error:/i.test(line)
      || /^GPT error:/i.test(line)
      || /^ChatGPT connection/i.test(line)
      || /^Search \"/i.test(line)
      || /^Web search /i.test(line);
  }

  private isHiddenHistoryBoundary(line: string): boolean {
    return /^Web search /i.test(line);
  }

  private buildHistoryEntryFromLine(line: string): { text: string; isUser: boolean } {
    const normalized = line.trimStart();
    if (/^User:/i.test(normalized)) {
      return { text: normalized.replace(/^User:\s*/i, ""), isUser: true };
    }
    return { text: line, isUser: false };
  }

  private resetConversationLog() {
    this.messages = [];
    this.logEntryCounter = 0;
  }

  private extractLastEditedUid(text: string): string | null {
    let lastUid: string | null = null;
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        continue;
      }
      const parsedUid = this.parseUidFromEditLine(line);
      if (parsedUid) {
        lastUid = parsedUid;
      }
    }
    return lastUid;
  }

  private parseUidFromEditLine(line: string): string | null {
    if (!line.startsWith("/edit")) {
      return null;
    }
    const remainder = line.slice("/edit".length).trim();
    if (!remainder) {
      return null;
    }
    const firstToken = remainder.split(/\s+/)[0];
    if (firstToken && !firstToken.includes("=")) {
      return firstToken;
    }
    const uidMatch = remainder.match(/uid=("(?:\\.|[^"\\])*"|[^\s]+)/);
    if (!uidMatch) {
      return null;
    }
    const rawValue = uidMatch[1];
    if (rawValue.startsWith("\"")) {
      try {
        return JSON.parse(rawValue);
      } catch {
        return rawValue.slice(1, -1);
      }
    }
    return rawValue;
  }

}

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


declare global {
  interface HTMLElementTagNameMap {
    "trip-app": TripApp;
  }
}
