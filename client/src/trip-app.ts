import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { Activity, PlanLine, TripModel } from "./types";
import { processUserCommand, extractSlashCommandLines } from "./commandUx";
import type { CommandProcessingResult } from "./commandUx";
import { buildPlanLines, describeActivity } from "./view/view-plan";
import type { DayEntry } from "./view/view-day";
import { buildDayItems } from "./view/view-day";
import { normalizeUserDate } from "./ux-date";
import type { PanelDetailLogEntry } from "./components/panel-detail";
import {
  persistLastTripId,
  readLastTripId,
  persistSelectedDate,
  readSelectedDate,
  clearSelectedDate,
  persistSelectedActivityUid,
  readSelectedActivityUid,
  clearSelectedActivityUid
} from "./storage";
import "./components/panel-plan";
import "./components/panel-day";
import "./components/panel-activity";
import "./components/panel-detail";

const AUTO_CHAT_MAX_FOLLOWUPS = 5;

@customElement("trip-app")
export class TripApp extends LitElement {
  @state() private messages: PanelDetailLogEntry[] = [];
  @state() private sending = false;
  @state() private tripModel: TripModel | null = null;
  @state() private planTitle = "Untitled Trip";
  @state() private planLines: PlanLine[] = [];
  @state() private currentTripId = "demo";
  @state() private selectedUid: string | null = null;
  @state() private selectedActivity: Activity | null = null;
  @state() private selectedDateKey: string | null = null;
  @state() private dayTitle = "Day";
  @state() private dayItems: DayEntry[] = [];
  @state() private hoveredActivity: Activity | null = null;
  @state() private dayDragPlanState: { uid: string; dateKey: string | null } | null = null;
  private attemptedAutoRestore = false;
  private pendingNewActivityPrevUids: Set<string> | null = null;
  private conversationLines: string[] = [];
  private logEntryCounter = 0;
  private pendingEditedUid: string | null = null;

  static styles = css`
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
      width: 300px;
      flex: 0 0 300px;
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

  render() {
    return html`
      <div class="layout">
        <section class="panel panel-left">
          <panel-plan
            .title=${this.planTitle}
            .lines=${this.planLines}
            .selectedKey=${this.selectedDateKey}
            .incomingActivityDrag=${this.dayDragPlanState}
            @plan-date-selected=${this.handlePlanDateSelected}
            @plan-date-move=${this.handlePlanDateMove}
          ></panel-plan>
        </section>
        <section class="panel panel-middle">
          <div class="panel panel-middle-top">
            <panel-day
              .title=${this.dayTitle}
              .items=${this.dayItems}
              .selectedUid=${this.selectedUid}
              @day-activity-hover=${this.handleDayActivityHover}
              @day-activity-select=${this.handleDayActivitySelect}
              @day-activity-drag-state=${this.handleDayActivityDragState}
              @day-activity-move=${this.handleDayActivityMove}
              @day-activity-move-date=${this.handleDayActivityMoveDate}
            ></panel-day>
          </div>
          <div class="panel panel-middle-bottom">
            <panel-activity
              .activity=${this.hoveredActivity}
              .canCreate=${Boolean(this.tripModel)}
              @panel-activity-create=${this.handleActivityCreate}
            ></panel-activity>
          </div>
        </section>
        <section class="panel panel-right">
          <panel-detail
            .messages=${this.messages}
            .serverBusy=${this.sending}
            @panel-detail-submit=${this.handlePanelSubmit}
          ></panel-detail>
        </section>
      </div>
    `;
  }

  private appendMessage(message: string, options?: { isUser?: boolean; conversationText?: string }) {
    this.recordConversationLine(message, {
      visible: true,
      isUser: options?.isUser,
      conversationText: options?.conversationText
    });
  }

  private recordConversationLine(
    message: string,
    options?: { visible?: boolean; isUser?: boolean; conversationText?: string }
  ) {
    const isVisible = options?.visible ?? true;
    const isUser = options?.isUser ?? false;
    const conversationText = options?.conversationText ?? message;
    this.conversationLines = [...this.conversationLines, conversationText].slice(-200);
    if (isVisible) {
      this.appendLogEntry({ id: this.nextLogEntryId(), kind: "text", text: message, isUser });
    }
  }

  private recordHiddenConversationLine(message: string) {
    this.recordConversationLine(message, { visible: false });
  }

  private appendLogEntry(entry: PanelDetailLogEntry) {
    this.messages = [...this.messages, entry];
  }

  private nextLogEntryId(): string {
    this.logEntryCounter += 1;
    return `log-${this.logEntryCounter}`;
  }

  private buildConversationHistory(): string {
    return this.conversationLines.slice(-50).join("\n");
  }

  private async handlePanelSubmit(event: CustomEvent<{ text: string }>) {
    await this.submitCommand(event.detail.text);
  }

  connectedCallback() {
    super.connectedCallback();
    this.tryAutoRestoreTrip();
    void this.announceChatConnection();
  }

  private rememberTripModel(model: TripModel) {
    this.tripModel = model;
    const newTripId = model.tripId?.trim() || model.tripName?.trim();
    if (newTripId) {
      const switchingTrip = newTripId !== this.currentTripId;
      this.currentTripId = newTripId;
      persistLastTripId(newTripId);
      if (switchingTrip) {
        this.selectedDateKey = null;
        this.hoveredActivity = null;
        this.selectedActivity = null;
        const storedUid = readSelectedActivityUid(newTripId);
        this.applySelectedUid(storedUid, { persist: false });
      }
    }
    this.updatePanels(model);

    if (this.pendingEditedUid) {
      const targetActivity = model.activities.find((activity) => activity.uid === this.pendingEditedUid);
      if (targetActivity) {
        this.setSelectedActivity(targetActivity);
        const canonicalDate = canonicalizeDateKey(targetActivity.date ?? null);
        if (canonicalDate) {
          this.selectedDateKey = canonicalDate;
          persistSelectedDate(this.currentTripId, canonicalDate);
          this.syncDaySelection(this.planLines);
        }
      }
      this.pendingEditedUid = null;
    }

    if (this.pendingNewActivityPrevUids) {
      const previous = this.pendingNewActivityPrevUids;
      this.pendingNewActivityPrevUids = null;
      const newActivity = model.activities.find(
        (activity) => activity.uid && !previous.has(activity.uid)
      );
      if (newActivity) {
        if (newActivity.date) {
          this.selectedDateKey = newActivity.date;
          persistSelectedDate(this.currentTripId, newActivity.date);
          this.syncDaySelection(this.planLines);
        }
        this.setSelectedActivity(newActivity);
      }
    }
  }

  private updatePanels(model: TripModel) {
    this.planTitle = this.derivePlanTitle(model);
    const lines = buildPlanLines(model.activities);
    this.planLines = lines;
    this.syncSelectionWithModel(model.activities);
    if (!this.selectedDateKey) {
      const storedDateKey = readSelectedDate(this.currentTripId);
      if (storedDateKey) {
        const canonical = canonicalizeDateKey(storedDateKey);
        if (canonical) {
          this.selectedDateKey = canonical;
          if (canonical !== storedDateKey) {
            persistSelectedDate(this.currentTripId, canonical);
          }
        } else {
          this.selectedDateKey = storedDateKey;
        }
      }
    }
    this.syncDaySelection(lines);
  }

  private syncSelectionWithModel(activities: Activity[]) {
    if (!this.selectedUid) {
      return;
    }
    const match = activities.find((activity) => activity.uid === this.selectedUid);
    if (!match) {
      this.setSelectedActivity(null);
      return;
    }
    this.setSelectedActivity(match);
    const canonicalDate = canonicalizeDateKey(match.date ?? null);
    if (canonicalDate && canonicalDate !== this.selectedDateKey) {
      this.selectedDateKey = canonicalDate;
      persistSelectedDate(this.currentTripId, canonicalDate);
    }
  }

  private derivePlanTitle(model?: TripModel | null) {
    if (!model) {
      return "Untitled Trip";
    }
    return model.tripId?.trim() || model.tripName?.trim() || "Untitled Trip";
  }

  private handlePlanDateSelected(event: CustomEvent<{ line: PlanLine }>) {
    const line = event.detail.line;
    if (!line || line.kind !== "dated") {
      return;
    }
    this.applyDaySelection(line);
  }

  private handlePlanDateMove(event: CustomEvent<{ fromKey: string; toKey: string }>) {
    const { fromKey, toKey } = event.detail;
    if (!fromKey || !toKey || fromKey === toKey) {
      return;
    }
    const targetLine = this.planLines.find(
      (line): line is Extract<PlanLine, { kind: "dated" }> => line.kind === "dated" && line.dateKey === toKey
    );
    if (targetLine) {
      this.applyDaySelection(targetLine);
    } else {
      this.selectedDateKey = toKey;
      persistSelectedDate(this.currentTripId, toKey);
    }
    void this.submitCommand(`/movedate from="${fromKey}" to="${toKey}"`, { skipChat: true });
  }

  private syncDaySelection(lines: PlanLine[]) {
    if (!this.selectedDateKey) {
      this.clearDaySelection();
      return;
    }

    const existing = lines.find(
      (line): line is Extract<PlanLine, { kind: "dated" }> =>
        line.kind === "dated" && line.dateKey === this.selectedDateKey
    );

    if (existing) {
      this.applyDaySelection(existing);
    } else {
      this.clearDaySelection();
    }
  }

  private applyDaySelection(line: Extract<PlanLine, { kind: "dated" }>) {
    this.hoveredActivity = null;
    this.selectedDateKey = line.dateKey;
    this.dayTitle = line.fullDisplayDate;
    this.dayItems = buildDayItems(line.activities, describeActivity);
    persistSelectedDate(this.currentTripId, line.dateKey);
    this.ensureActivitySelection(line.activities);
  }

  private clearDaySelection() {
    this.selectedDateKey = null;
    this.dayTitle = "Day";
    this.dayItems = [];
    this.setSelectedActivity(null);
    clearSelectedDate(this.currentTripId);
  }

  public setSelectedUid(uid: string | null) {
    this.applySelectedUid(uid);
  }

  private handleDayActivityHover(event: CustomEvent<{ activity: Activity | null }>) {
    this.hoveredActivity = event.detail.activity ?? null;
  }

  private handleDayActivitySelect(event: CustomEvent<{ activity: Activity }>) {
    this.setSelectedActivity(event.detail.activity);
  }

  private handleDayActivityDragState(event: CustomEvent<{ active: boolean; uid?: string; dateKey?: string | null }>) {
    if (!event.detail?.active) {
      this.dayDragPlanState = null;
      return;
    }
    const uid = event.detail.uid;
    if (!uid) {
      this.dayDragPlanState = null;
      return;
    }
    this.dayDragPlanState = { uid, dateKey: event.detail.dateKey ?? null };
  }

  private handleDayActivityMove(event: CustomEvent<{ uid: string; time: string }>) {
    const uid = event.detail.uid?.trim();
    const time = event.detail.time?.trim();
      if (!uid || !time) {
      return;
    }
    this.applySelectedUid(uid);
    void this.submitCommand(`/edit ${uid} time="${time}"`, { skipChat: true });
  }

  private handleDayActivityMoveDate(event: CustomEvent<{ uid: string; dateKey: string }>) {
    const uid = event.detail.uid?.trim();
    const dateKey = event.detail.dateKey?.trim();
    if (!uid || !dateKey) {
      return;
    }
    this.dayDragPlanState = null;
    const targetLine = this.planLines.find(
      (line): line is Extract<PlanLine, { kind: "dated" }> => line.kind === "dated" && line.dateKey === dateKey
    );
    if (targetLine) {
      this.applyDaySelection(targetLine);
    } else {
      this.selectedDateKey = dateKey;
      persistSelectedDate(this.currentTripId, dateKey);
    }
    this.applySelectedUid(uid);
    void this.submitCommand(`/edit ${uid} date="${dateKey}"`, { skipChat: true });
  }

  private setSelectedActivity(activity: Activity | null) {
    if (activity) {
      this.selectedActivity = activity;
      this.applySelectedUid(activity.uid);
      this.hoveredActivity = activity;
    } else {
      this.selectedActivity = null;
      this.applySelectedUid(null);
      this.hoveredActivity = null;
    }
  }

  private applySelectedUid(uid: string | null, options?: { persist?: boolean }) {
    this.selectedUid = uid;
    if (options?.persist === false) {
      return;
    }
    if (uid) {
      persistSelectedActivityUid(this.currentTripId, uid);
    } else {
      clearSelectedActivityUid(this.currentTripId);
    }
  }

  private ensureActivitySelection(activities: Activity[]) {
    let targetUid = this.selectedUid;
    if (!targetUid) {
      targetUid = readSelectedActivityUid(this.currentTripId);
    }

    if (!targetUid) {
      if (this.hoveredActivity && !activities.some((activity) => activity.uid === this.hoveredActivity?.uid)) {
        this.hoveredActivity = null;
      }
      return;
    }

    const match = activities.find((activity) => activity.uid === targetUid);
    if (match) {
      this.setSelectedActivity(match);
    } else {
      this.setSelectedActivity(null);
    }
  }

  private handleActivityCreate() {
    if (!this.tripModel) {
      return;
    }
    const parts = ["/add visit", 'name="New Activity"'];
    if (this.selectedDateKey) {
      parts.push(`date="${this.selectedDateKey}"`);
    }
    const derivedTime = this.deriveNextActivityTime();
    if (derivedTime) {
      parts.push(`time="${derivedTime}"`);
    }
    this.pendingNewActivityPrevUids = this.captureCurrentActivityUids();
    void this.submitCommand(parts.join(" "), { skipChat: true });
  }

  private deriveNextActivityTime(): string | null {
    const time = this.selectedActivity?.time?.trim();
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

    const shouldShowSearchResults = options?.showSearchResults ?? true;
    const result = await processUserCommand({
      text,
      currentTripId: this.currentTripId,
      selectedUid: this.selectedUid,
        appendMessage: (message, meta) => this.appendMessage(message, meta),
      setSending: (sending) => {
        this.sending = sending;
      },
      rememberTripModel: (model) => this.rememberTripModel(model),
      echoCommands: !(options?.suppressEcho ?? false)
    });

    if (result.payload?.searchResults) {
      const queryText = result.payload.query ?? "(unknown query)";
      const snippets = result.payload.searchResults;
      const detailedSummary = `Web search for "${queryText}" returned ${snippets.length} result${snippets.length === 1 ? "" : "s"}.`;
      const humanSummary = `Search "${queryText}" (${snippets.length})`;
      const lines: string[] = [];
      lines.push(detailedSummary);
      snippets.forEach((snippet, index) => {
        lines.push(`${index + 1}. ${snippet}`);
      });
      this.recordConversationLine(lines.join("\n"), { visible: false });
      if (shouldShowSearchResults) {
        this.appendLogEntry({
          id: this.nextLogEntryId(),
          kind: "search",
          summary: humanSummary,
          snippets
        });
      }
    }

    if (!result.ok || options?.skipChat) {
      return result;
    }

    await this.requestChatResponse(text);
    return result;
  }

  private async announceChatConnection(): Promise<void> {
    try {
      const response = await fetch("/api/gpt/health");
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

  private async requestChatResponse(userInput: string, options?: { autoDepth?: number }): Promise<void> {
    const trimmed = userInput.trim();
    if (!trimmed) {
      return;
    }
    const autoDepth = options?.autoDepth ?? 0;
    this.sending = true;
    try {
      const response = await fetch(`/api/trip/${this.currentTripId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: userInput,
          conversationHistory: this.buildConversationHistory()
        })
      });
      const payload = (await response.json().catch(() => ({}))) as {
        ok?: boolean;
        text?: string;
        error?: string;
        model?: string;
      };

      if (response.ok && payload?.ok && payload.text) {
        const modelLabel = payload.model ?? "chat";
        this.appendMessage(`GPT (${modelLabel}): ${payload.text}`);
        const needsFollowUp = await this.handleAssistantCommands(payload.text);
        if (needsFollowUp && autoDepth < AUTO_CHAT_MAX_FOLLOWUPS) {
          const nextDepth = autoDepth + 1;
          await this.requestChatResponse("(auto) continue", { autoDepth: nextDepth });
        }
      } else {
        const detail = payload?.error ?? response.statusText ?? "Failed";
        this.appendMessage(`GPT error: ${detail}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.appendMessage(`GPT error: ${message}`);
    } finally {
      this.sending = false;
    }
  }

  private async handleAssistantCommands(responseText: string): Promise<boolean> {
    const slashCommands = extractSlashCommandLines(responseText);
    if (!slashCommands.length) {
      return false;
    }
    const commandBlock = slashCommands.join("\n");
    const result = await this.submitCommand(commandBlock, { skipChat: true, suppressEcho: true });
    if (!result?.ok) {
      return false;
    }
    const requiresFollowUp = slashCommands.some((line) => line.trimStart().startsWith("/websearch"));
    return requiresFollowUp;
  }

  private tryAutoRestoreTrip() {
    if (this.attemptedAutoRestore) {
      return;
    }
    this.attemptedAutoRestore = true;
    const storedTripId = readLastTripId();
    if (!storedTripId) {
      return;
    }
    this.currentTripId = storedTripId;
    const storedUid = readSelectedActivityUid(storedTripId);
    this.applySelectedUid(storedUid, { persist: false });
    void this.submitCommand(`/trip ${storedTripId}`, { skipChat: true });
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

function canonicalizeDateKey(value: string | null): string | null {
  if (!value) {
    return null;
  }
  return normalizeUserDate(value) ?? value;
}

declare global {
  interface HTMLElementTagNameMap {
    "trip-app": TripApp;
  }
}
