import { LitElement, PropertyValues, css, html } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { customElement, property, state } from "lit/decorators.js";
import type { Activity } from "../types";
import type { DayEntry } from "../view/view-day";
import { renderDayIndicatorSlots, renderActivityIndicatorSlots, indicatorSlotStyles } from "./indicators";

type PlanPanelElement = HTMLElement & {
  getDateInfoAtPoint?: (clientX: number, clientY: number) => { key: string; display: string } | null;
};

@customElement("panel-day")
export class PanelDay extends LitElement {
  @property({ type: String }) title = "Day";
  @property({ attribute: false }) items: DayEntry[] = [];
  @property({ type: String }) focusedUid: string | null = null;
  // Indicator slot properties
  @property({ type: Number }) flightCount = 0;
  @property({ type: Boolean }) flightBooked = false;
  @property({ type: Boolean }) hasRentalCar = false;
  @property({ type: Boolean }) rentalCarBooked = false;
  @property({ type: String }) lodgingStatus: "none" | "unbooked" | "booked" | "multiple" = "none";
  @property({ type: String }) lodgingCity?: string;
  @property({ type: Number }) mealCount = 0;
  @property({ type: Number }) mealsNeedingReservation = 0;
  @property({ type: Boolean }) hasDateMismatchIssue = false;
  @property({ type: Boolean }) issueNoTransportToLodging = false;
  @property({ type: Boolean }) issueNoTransportToFlight = false;
  @property({ attribute: false }) mismatchedUids: Set<string> = new Set();
  @property({ attribute: false, hasChanged: () => true }) activityUidsWithAlarms: Set<string> = new Set();
  @state() private draggingUid: string | null = null;
  @state() private dropTargetIndex: number | null = null;

  private dragContext: {
    uid: string;
    pointerId: number;
    ghost: HTMLElement;
    offsetX: number;
    offsetY: number;
    originalTime: string;
    originalDateKey: string | null;
    planDateKey: string | null;
    planDisplay: string | null;
  } | null = null;

  static styles = [indicatorSlotStyles, css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      font-family: inherit;
      color: #0f172a;
    }

    .title-row {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
      margin: 0 0 0.5rem 0;
    }

    .title {
      margin: 0;
      font-size: 1.15rem;
      font-weight: 600;
      color: #0f172a;
    }

    /* Indicator slots - right-justified, sized proportional to title */
    .indicator-slots {
      display: flex;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }

    .indicator-slot {
      width: 1em;
      height: 1em;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 1.15rem;
    }

    .indicator-slot svg {
      width: 1em;
      height: 1em;
    }

    /* Icon colors by status */
    .indicator-slot.status-green svg {
      color: #22c55e;
    }

    .indicator-slot.status-yellow svg {
      color: #eab308;
    }

    .indicator-slot.status-red svg {
      color: #ef4444;
    }

    .indicator-slot.status-purple svg {
      color: #a855f7;
    }

    .indicator-slot.status-black svg {
      color: #0f172a;
    }

    .indicator-slot.status-hidden {
      visibility: hidden;
    }

    /* Activity row indicator slots - right-justified, smaller than title */
    .activity-indicator-slots {
      display: flex;
      align-items: center;
      gap: 2px;
      margin-left: auto;
      flex-shrink: 0;
    }

    .activity-indicator-slots .indicator-slot {
      width: 14px;
      height: 14px;
      font-size: 0.85rem;
    }

    .activity-indicator-slots .indicator-slot svg {
      width: 12px;
      height: 12px;
    }

    .empty {
      font-style: italic;
      color: #94a3b8;
      margin: 0;
    }

    .list {
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
      overflow-y: auto;
      padding-right: 0.25rem;
    }

    .activity {
      display: flex;
      gap: 0.75rem;
      align-items: baseline;
      font-size: 0.95rem;
      cursor: pointer;
      border-radius: 6px;
      margin: 0 0 0.25rem 0;
      padding: 0 0.25rem 0 1.5rem;
      border: 1px solid transparent;
      position: relative;
    }

    .activity:last-child {
      margin-bottom: 0;
    }

    .activity:focus-visible,
    .activity:hover {
      background: #eef2ff;
    }

    .activity.focused {
      background: #e0e7ff;
      border-color: #818cf8;
    }

    .activity.marked {
      background: #e8f8e5;
      border-color: #bbf7d0;
    }

    .activity.drop-target {
      border-color: #1d4ed8;
      background: #dbeafe;
    }

    .activity.dragging-source {
      opacity: 0;
    }

    .activity.placeholder {
      cursor: default;
      opacity: 0.35;
      margin-top: 0;
      margin-bottom: 0;
      padding-top: 0;
      padding-bottom: 0;
    }

    .drag-hint {
      position: absolute;
      left: 0.35rem;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.15s ease;
      pointer-events: auto;
    }

    .activity:hover .drag-hint,
    .activity:focus-visible .drag-hint {
      opacity: 1;
    }

    .time {
      font-weight: 600;
      color: #1e293b;
      min-width: 75px;
      font-family: "Courier New", Courier, monospace;
      font-size: 0.8em;
      white-space: pre;
    }

    .label {
      color: #475569;
      flex: 1;
      font-family: "Segoe UI", Arial, sans-serif;
    }

    .placeholder-label {
      border-bottom: 1px dashed #e2e8f0;
      width: 100%;
      display: block;
      min-height: 0;
      height: 0;
      line-height: 0;
      font-size: 0;
      margin: 0;
    }

    .drag-ghost {
      position: fixed;
      z-index: 2000;
      pointer-events: none;
      border: 2px solid #1d4ed8;
      border-radius: 6px;
      background: #ffffff;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.15);
      opacity: 0.95;
      transform-origin: top left;
      transform: scale(0.85);
      font-size: 0.9em;
    }

    .delete-button {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 18px;
      height: 18px;
      border: none;
      background: transparent;
      color: #94a3b8;
      font-size: 0.75rem;
      font-weight: 600;
      border-radius: 3px;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
      flex-shrink: 0;
      margin-left: 0.25rem;
    }

    .activity:hover .delete-button,
    .activity:focus-visible .delete-button {
      opacity: 1;
    }

    .delete-button:hover {
      background: #fee2e2;
      color: #dc2626;
    }
  `];

  render() {
    return html`
      <div class="title-row">
        <h3 class="title">${this.title}</h3>
        ${this.renderIndicatorSlots()}
      </div>
      <div class="list">
        ${this.items.map((item, index) =>
          item.isPlaceholder
            ? html`<div
                class=${classMap(this.buildActivityClasses({ index, placeholder: true }))}
                data-index=${index}
                data-time=${item.time}
              >
                <span class="time">${item.displayTime}</span>
                <span class="label placeholder-label"></span>
              </div>`
            : this.renderActivityRow(item, index)
        )}
      </div>
    `;
  }

  protected updated(changedProps: PropertyValues<this>) {
    super.updated(changedProps);
    if ((changedProps.has("focusedUid") || changedProps.has("items")) && this.focusedUid) {
      this.ensureFocusedActivityVisible();
    }
  }

  private ensureFocusedActivityVisible() {
    const container = this.renderRoot.querySelector<HTMLElement>(".list");
    if (!container || !this.focusedUid) {
      return;
    }
    const uid = this.focusedUid;
    const escapedUid = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(uid) : uid.replace(/"/g, '\"');
    const selector = `.activity[data-uid="${escapedUid}"]`;
    const row = container.querySelector<HTMLElement>(selector);
    if (!row) {
      return;
    }
    const containerRect = container.getBoundingClientRect();
    const rowRect = row.getBoundingClientRect();
    const fullyVisible = rowRect.top >= containerRect.top && rowRect.bottom <= containerRect.bottom;
    if (fullyVisible) {
      return;
    }
    // Keep focused day activity in view so navigation feels consistent on initial load.
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  private renderActivityRow(item: DayEntry, index: number) {
    const activity = item.activity;
    if (!activity) {
      return null;
    }
    const isFocused = this.focusedUid === activity.uid;
    return html`<div
      class=${classMap(this.buildActivityClasses({ index, uid: activity.uid, focused: isFocused, marked: item.isMarked }))}
      data-index=${index}
      data-time=${item.time}
      data-uid=${activity.uid}
      tabindex="0"
      @mouseenter=${() => this.emitActivityHover(activity)}
      @focus=${() => this.emitActivityHover(activity)}
      @click=${(event: MouseEvent) => this.handleActivityClick(event, item, activity, index)}
      @keydown=${(event: KeyboardEvent) => this.handleKey(event, activity)}
      aria-selected=${isFocused}
    >
      <span
        class="drag-hint"
        role="button"
        aria-label="Drag activity"
        @pointerdown=${(event: PointerEvent) => this.handleDragPointerDown(event, item)}
      >
        ${this.renderGripIcon()}
      </span>
      <span class="time">${item.displayTime}</span>
      <span class="label">${item.label}</span>
      ${this.renderActivityIndicators(activity)}
      <button
        class="delete-button"
        title="Delete activity"
        @click=${(e: MouseEvent) => this.handleDeleteClick(e, activity)}
      >✕</button>
    </div>`;
  }

  private handleDeleteClick(event: MouseEvent, activity: Activity) {
    event.preventDefault();
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("day-activity-delete", {
        detail: { uid: activity.uid },
        bubbles: true,
        composed: true
      })
    );
  }

  private handleActivityClick(event: MouseEvent, item: DayEntry, activity: Activity, index: number) {
    if (event.shiftKey) {
      event.preventDefault();
      event.stopPropagation();
      this.dispatchEvent(
        new CustomEvent("day-activity-range-mark", {
          detail: { uid: activity.uid, index },
          bubbles: true,
          composed: true
        })
      );
      return;
    }

    if (event.ctrlKey) {
      event.preventDefault();
      event.stopPropagation();
      this.dispatchEvent(
        new CustomEvent("day-activity-toggle-mark", {
          detail: { uid: activity.uid, mark: !item.isMarked },
          bubbles: true,
          composed: true
        })
      );
      return;
    }
    this.emitActivityFocus(activity);
  }

  private buildActivityClasses(options: {
    index: number;
    uid?: string | null;
    focused?: boolean;
    placeholder?: boolean;
    marked?: boolean;
  }) {
    return {
      activity: true,
      placeholder: Boolean(options.placeholder),
      focused: Boolean(options.focused),
      marked: Boolean(options.marked),
      "drop-target": this.dropTargetIndex === options.index,
      "dragging-source": Boolean(options.uid && this.draggingUid === options.uid)
    };
  }

  private renderGripIcon() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke-width="1.5"
      stroke="currentColor"
      width="14"
      height="14"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
    </svg>`;
  }

  // --- Indicator slot rendering (uses shared indicators) ---
  private renderIndicatorSlots() {
    return html`<div class="indicator-slots">
      ${renderDayIndicatorSlots({
        flightCount: this.flightCount,
        flightBooked: this.flightBooked,
        hasRentalCar: this.hasRentalCar,
        rentalCarBooked: this.rentalCarBooked,
        lodgingStatus: this.lodgingStatus,
        lodgingCity: this.lodgingCity,
        mealCount: this.mealCount,
        mealsNeedingReservation: this.mealsNeedingReservation,
        hasDateMismatchIssue: this.hasDateMismatchIssue,
        issueNoTransportToLodging: this.issueNoTransportToLodging,
        issueNoTransportToFlight: this.issueNoTransportToFlight,
      })}
    </div>`;
  }

  /**
   * Check if a flight or lodging activity lacks transport before its scheduled time.
   * For flights, we need transport AFTER any earlier flight on the same day.
   */
  private checkNoTransportBefore(activity: Activity): boolean {
    const activityType = activity.activityType;
    if (activityType !== "flight" && activityType !== "lodging") {
      return false;
    }
    
    const activityTime = activity.time;
    if (!activityTime || !/^\d{2}:\d{2}/.test(activityTime)) {
      return false; // No time specified
    }
    
    // If there's a booked rental car for this day, transport is covered
    if (this.hasRentalCar && this.rentalCarBooked) {
      return false;
    }
    
    // Get all transport times, sorted
    const transportTimes: string[] = [];
    for (const item of this.items) {
      const other = item.activity;
      if (!other) continue;
      if (other.activityType !== "transport") continue;
      const transportTime = other.time;
      if (transportTime && /^\d{2}:\d{2}/.test(transportTime)) {
        transportTimes.push(transportTime);
      }
    }
    transportTimes.sort();
    
    if (activityType === "flight") {
      // For flights, find the previous flight time (if any)
      let previousFlightTime = "00:00";
      for (const item of this.items) {
        const other = item.activity;
        if (!other || other.uid === activity.uid) continue;
        if (other.activityType !== "flight") continue;
        const otherTime = other.time;
        if (otherTime && /^\d{2}:\d{2}/.test(otherTime) && otherTime < activityTime) {
          if (otherTime > previousFlightTime) {
            previousFlightTime = otherTime;
          }
        }
      }
      
      // Need transport between previousFlightTime and this flight
      if (previousFlightTime === "00:00") {
        // First flight of day - just need transport before it
        return !transportTimes.some(t => t < activityTime);
      } else {
        // Subsequent flight - need transport AFTER the previous flight and BEFORE this one
        return !transportTimes.some(t => t > previousFlightTime && t < activityTime);
      }
    } else {
      // Lodging - just need any transport before it
      return !transportTimes.some(t => t < activityTime);
    }
  }

  // --- Activity row indicator rendering (uses shared indicators) ---
  private renderActivityIndicators(activity: Activity) {
    const isBooked = activity.status === "booked" || activity.status === "completed";
    const hasMismatch = this.mismatchedUids.has(activity.uid);
    const reservationNeeded = (activity as unknown as Record<string, unknown>).reservationNeeded === true;
    const noTransportBefore = this.checkNoTransportBefore(activity);
    const hasAlarm = this.activityUidsWithAlarms.has(activity.uid);

    const onAlarmToggle = () => {
      this.dispatchEvent(new CustomEvent("panel-day-alarm-toggle", {
        bubbles: true,
        composed: true,
        detail: { activityUid: activity.uid, hasAlarm }
      }));
    };

    return html`<div class="activity-indicator-slots">
      ${renderActivityIndicatorSlots({
        activityType: activity.activityType,
        isBooked,
        hasMismatch,
        reservationNeeded,
        noTransportBefore,
        hasAlarm,
      }, onAlarmToggle)}
    </div>`;
  }

  private handleDragPointerDown(event: PointerEvent, item: DayEntry) {
    const activity = item.activity;
    if (!activity) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget as HTMLElement;
    const row = handle.closest<HTMLElement>(".activity");
    if (!row || this.dragContext) {
      return;
    }

    const rect = row.getBoundingClientRect();
    const ghost = row.cloneNode(true) as HTMLElement;
    ghost.classList.add("drag-ghost");
    ghost.style.width = `${rect.width}px`;
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    const hostRoot = this.shadowRoot ?? this.renderRoot;
    hostRoot?.appendChild(ghost);

    this.dragContext = {
      uid: activity.uid,
      pointerId: event.pointerId,
      ghost,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      originalTime: item.time,
      originalDateKey: activity.date ?? null,
      planDateKey: null,
      planDisplay: null
    };
    this.draggingUid = activity.uid;
    this.dropTargetIndex = this.extractIndex(row);
    this.updateGhostTimeForIndex(this.dropTargetIndex);
    this.emitDragState({ active: true, uid: activity.uid, dateKey: null });
    window.addEventListener("pointermove", this.handleGlobalPointerMove, true);
    window.addEventListener("pointerup", this.handleGlobalPointerUp, true);
    window.addEventListener("pointercancel", this.handleGlobalPointerCancel, true);
    window.addEventListener("keydown", this.handleGlobalKeyDown, true);
    window.addEventListener("wheel", this.handleGlobalWheel, { passive: false, capture: true });
  }

  private handleGlobalPointerMove = (event: PointerEvent) => {
    if (!this.dragContext || event.pointerId !== this.dragContext.pointerId) {
      return;
    }
    event.preventDefault();
    const { ghost, offsetX, offsetY } = this.dragContext;
    ghost.style.left = `${event.clientX - offsetX}px`;
    ghost.style.top = `${event.clientY - offsetY}px`;

    let localTarget: Element | null = null;
    if (ghost) {
      const previousVisibility = ghost.style.visibility;
      ghost.style.visibility = "hidden";
      localTarget = this.shadowRoot?.elementFromPoint(event.clientX, event.clientY) ?? null;
      ghost.style.visibility = previousVisibility;
    } else {
      localTarget = this.shadowRoot?.elementFromPoint(event.clientX, event.clientY) ?? null;
    }
    const row = localTarget?.closest?.(".activity") as HTMLElement | null;
    const index = this.extractIndex(row);
    if (index !== this.dropTargetIndex) {
      this.dropTargetIndex = index;
    }

    const planInfo = this.resolvePlanTarget(event.clientX, event.clientY);
    console.debug("[panel-day] drag move", {
      pointer: { x: event.clientX, y: event.clientY },
      localIndex: this.dropTargetIndex,
      planInfo
    });
    const planKey = planInfo?.key ?? null;
    if (planKey !== this.dragContext.planDateKey) {
      this.dragContext.planDateKey = planKey;
      this.dragContext.planDisplay = planInfo?.display ?? null;
      this.emitDragState({ active: true, uid: this.dragContext.uid, dateKey: planKey });
    }

    if (planInfo) {
      this.setGhostText(planInfo.display);
    } else {
      this.updateGhostTimeForIndex(this.dropTargetIndex);
    }
  };

  private handleGlobalPointerUp = (event: PointerEvent) => {
    if (!this.dragContext || event.pointerId !== this.dragContext.pointerId) {
      return;
    }
    event.preventDefault();
    const uid = this.dragContext.uid;
    const targetIndex = this.dropTargetIndex;
    const targetTime = this.getTimeForIndex(targetIndex);
    const planKey = this.dragContext.planDateKey;
    const shouldMoveDate = Boolean(planKey && planKey !== this.dragContext.originalDateKey);
    const commitTime = Boolean(!planKey && targetTime && targetTime !== this.dragContext.originalTime);
    this.finishDrag();
    if (shouldMoveDate && planKey) {
      this.dispatchEvent(
        new CustomEvent("day-activity-move-date", {
          detail: { uid, dateKey: planKey },
          bubbles: true,
          composed: true
        })
      );
    } else if (commitTime && targetTime) {
      this.dispatchEvent(
        new CustomEvent("day-activity-move", {
          detail: { uid, time: targetTime },
          bubbles: true,
          composed: true
        })
      );
    }
  };

  private handleGlobalPointerCancel = (event: PointerEvent) => {
    if (!this.dragContext || event.pointerId !== this.dragContext.pointerId) {
      return;
    }
    event.preventDefault();
    this.finishDrag();
  };


  private handleGlobalKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && this.dragContext) {
      event.preventDefault();
      this.finishDrag();
    }
  };

  private finishDrag() {
    if (this.dragContext) {
      this.dragContext.ghost.remove();
    }
    this.dragContext = null;
    this.draggingUid = null;
    this.dropTargetIndex = null;
    this.emitDragState({ active: false });
    window.removeEventListener("pointermove", this.handleGlobalPointerMove, true);
    window.removeEventListener("pointerup", this.handleGlobalPointerUp, true);
    window.removeEventListener("pointercancel", this.handleGlobalPointerCancel, true);
    window.removeEventListener("keydown", this.handleGlobalKeyDown, true);
    window.removeEventListener("wheel", this.handleGlobalWheel, true);
  }

  private handleGlobalWheel = (event: WheelEvent) => {
    if (!this.dragContext) {
      return;
    }
    const list = this.renderRoot.querySelector<HTMLElement>(".list");
    if (!list) {
      return;
    }
    event.preventDefault();
    list.scrollTop += event.deltaY;
    list.scrollLeft += event.deltaX;
  };

  private updateGhostTimeForIndex(index: number | null) {
    if (!this.dragContext) {
      return;
    }
    const time = this.getTimeForIndex(index);
    if (!time) {
      return;
    }
    this.setGhostText(time);
  }

  private setGhostText(text: string | null) {
    if (!this.dragContext || !text) {
      return;
    }
    const ghostTime = this.dragContext.ghost.querySelector<HTMLElement>(".time");
    if (ghostTime) {
      ghostTime.textContent = text;
    }
  }

  private getTimeForIndex(index: number | null): string | null {
    if (index === null || index < 0 || index >= this.items.length) {
      return null;
    }
    return this.items[index]?.time ?? null;
  }

  private extractIndex(row: Element | null): number | null {
    if (!row) {
      return null;
    }
    const attr = row.getAttribute("data-index");
    if (attr === null) {
      return null;
    }
    const value = Number(attr);
    return Number.isNaN(value) ? null : value;
  }

  private emitActivityHover(activity: DayEntry["activity"]) {
    this.dispatchEvent(
      new CustomEvent("day-activity-hover", {
        detail: { activity },
        bubbles: true,
        composed: true
      })
    );
  }

  private emitActivityFocus(activity: DayEntry["activity"]) {
    this.dispatchEvent(
      new CustomEvent("day-activity-focus", {
        detail: { activity },
        bubbles: true,
        composed: true
      })
    );
  }

  private handleKey(event: KeyboardEvent, activity: DayEntry["activity"]) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.emitActivityFocus(activity);
    }
  }

  private resolvePlanTarget(clientX: number, clientY: number): { key: string; display: string } | null {
    const element = this.elementFromDocumentPoint(clientX, clientY);
    const hostNode = this.findPlanHost(element);
    if (!hostNode || typeof hostNode.getDateInfoAtPoint !== "function") {
      return null;
    }
    const info = hostNode.getDateInfoAtPoint(clientX, clientY);
    console.debug("[panel-day] plan target", {
      host: hostNode.tagName,
      info
    });
    return info;
  }

  private elementFromDocumentPoint(clientX: number, clientY: number): Element | null {
    const ghost = this.dragContext?.ghost ?? null;
    const restoreGhostVisibility = ghost ? this.hideGhostTemporarily(ghost) : null;
    const element = this.deepElementFromPoint(document, clientX, clientY);
    if (restoreGhostVisibility) {
      restoreGhostVisibility();
    }
    console.debug("[panel-day] elementFromPoint", {
      tag: element instanceof HTMLElement ? element.tagName : element?.constructor?.name,
      clientX,
      clientY
    });
    return element;
  }

  private hideGhostTemporarily(ghost: HTMLElement): () => void {
    const previousVisibility = ghost.style.visibility;
    ghost.style.visibility = "hidden";
    return () => {
      ghost.style.visibility = previousVisibility;
    };
  }

  private deepElementFromPoint(root: DocumentOrShadowRoot, clientX: number, clientY: number): Element | null {
    let currentRoot: DocumentOrShadowRoot | null = root;
    let lastElement: Element | null = null;
    while (currentRoot) {
      const found = currentRoot.elementFromPoint(clientX, clientY) as Element | null;
      if (!found || found === lastElement) {
        return found ?? lastElement;
      }
      lastElement = found;
      const shadowRoot = found instanceof HTMLElement ? found.shadowRoot : null;
      if (shadowRoot) {
        currentRoot = shadowRoot;
        continue;
      }
      currentRoot = null;
    }
    return lastElement;
  }

  private findPlanHost(start: Element | null): PlanPanelElement | null {
    let current: Element | Node | null = start;
    while (current) {
      if (current instanceof HTMLElement) {
        if (current.tagName === "PANEL-PLAN") {
          return current as PlanPanelElement;
        }
        if (current.parentElement) {
          current = current.parentElement;
          continue;
        }
        const root = current.getRootNode();
        if (root instanceof ShadowRoot) {
          current = root.host;
          continue;
        }
        current = null;
        continue;
      }
      if (current instanceof ShadowRoot) {
        current = current.host;
        continue;
      }
      break;
    }
    return null;
  }

  private emitDragState(detail: { active: boolean; uid?: string; dateKey?: string | null }) {
    this.dispatchEvent(
      new CustomEvent("day-activity-drag-state", {
        detail,
        bubbles: true,
        composed: true
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "panel-day": PanelDay;
  }
}
