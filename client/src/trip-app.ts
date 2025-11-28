import { LitElement, css, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import type { Activity, PlanLine, TripModel } from "./types";
import { processUserCommand, extractSlashCommandLines } from "./commandUx";
import type { CommandProcessingResult } from "./commandUx";
import { buildPlanLines, describeActivity } from "./view/view-plan";
import type { DayEntry } from "./view/view-day";
import { buildDayItems } from "./view/view-day";
import { panelFocus } from "./focus";
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
import "./components/panel-plan";
import "./components/panel-day";
import "./components/panel-activity";
import "./components/panel-detail";

const AUTO_CHAT_MAX_FOLLOWUPS = 5;
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
  @state() private dayDragPlanState: { uid: string; date: string | null } | null = null;
  private attemptedAutoRestore = false;
  private pendingNewActivityPrevUids: Set<string> | null = null;
  private conversationLines: string[] = [];
  private logEntryCounter = 0;
  private pendingEditedUid: string | null = null;
  private conversationHistoryRequestId = 0;
  
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

  render() {
    return html`
      <div class="layout">
        <section class="panel panel-left">
          <panel-plan
            .title=${this.planTitle}
            .lines=${this.planLines}
            .focusedKey=${this.__focusedDate}
            .incomingActivityDrag=${this.dayDragPlanState}
            @plan-date-focused=${this.handlePlanDateFocused}
            @plan-date-move=${this.handlePlanDateMove}
          ></panel-plan>
        </section>
        <section class="panel panel-middle">
          <div class="panel panel-middle-top">
            <panel-day
              .title=${this.dayTitle}
              .items=${this.dayItems}
              .focusedUid=${this.__focusedUid}
              @day-activity-hover=${this.handleDayActivityHover}
              @day-activity-focus=${this.handleDayActivityFocus}
              @day-activity-drag-state=${this.handleDayActivityDragState}
              @day-activity-move=${this.handleDayActivityMove}
              @day-activity-move-date=${this.handleDayActivityMoveDate}
            ></panel-day>
          </div>
          <div class="panel panel-middle-bottom">
            <panel-activity
              .activity=${this.__hoveredActivity}
              .canCreate=${Boolean(this.tripModel)}
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
  let lookupActivityByUidFn = (uid:string | null) => this.tripModel?.activities.find((activity) => activity.uid === uid) ?? null;
  let onFocusedDateChangeFn = () => this.onFocusedDateChange(this.planLines);
	panelFocus.attachHost(
      this,
      lookupActivityByUidFn,
    onFocusedDateChangeFn  
    );
    this.tryAutoRestoreTrip();
    void this.loadConversationHistory(this.currentTripId);
    void this.announceChatConnection();
  }

  disconnectedCallback() {
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
    const lines = buildPlanLines(model.activities);
    this.planLines = lines;
    this.onFocusedDateChange(lines);

    if (!panelFocus.date) {
      panelFocus.date = loadFocusedDate(this.currentTripId);
    }
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
    void this.submitCommand(`/movedate from="${fromKey}" to="${toKey}"`, { skipChat: true });
  }

  private onFocusedDateChange(lines: PlanLine[]) {
    const existing = !panelFocus.date ? null : lines.find(
      (line): line is Extract<PlanLine, { kind: "dated" }> =>
        line.kind === "dated" && line.date === panelFocus.date
    );

    this.dayTitle = existing ? existing.fullDisplayDate : "Day";
    this.dayItems = existing ? buildDayItems(existing.activities, describeActivity) : [];
  }

  private handleDayActivityHover(event: CustomEvent<{ activity: Activity | null }>) {
    panelFocus.hoveredActivity = event.detail.activity ?? null;
  }

  private handleDayActivityFocus(event: CustomEvent<{ activity: Activity }>) {
    panelFocus.activityUid = event.detail.activity.uid;
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
    const result = await processUserCommand({
      text,
      currentTripId: this.currentTripId,
      focusedUid: panelFocus.activityUid,
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

  private containsAddCommand(text: string): boolean {
    const commands = extractSlashCommandLines(text);
    return commands.some((line) => line.trimStart().toLowerCase().startsWith("/add"));
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
          conversationHistory: this.buildConversationHistory(),
          focusSummary: panelFocus.describeFocus()
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
      const response = await fetch(`/api/trip/${encodeURIComponent(tripId)}/conversation`);
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
    this.conversationLines = [normalized];
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
    this.conversationLines = [];
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
