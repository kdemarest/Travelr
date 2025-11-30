import { LitElement, PropertyValues, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { PlanLine } from "../types";
import { buildNotation } from "../view/view-plan";
import { parseFlexibleDate } from "../datetime";
import { 
  renderDayIndicatorSlots, 
  indicatorSlotStyles 
} from "./indicators";

@customElement("panel-plan")
export class PanelPlan extends LitElement {
  @property({ type: String }) title = "Untitled Trip";
  @property({ type: Array }) lines: PlanLine[] = [];
  @property({ type: String }) focusedKey: string | null = null;
  @property({ attribute: false }) incomingActivityDrag: { uid: string | null; dateKey: string | null } | null = null;
  @state() private hoveredKey: string | null = null;
  @state() private draggingKey: string | null = null;
  @state() private dropTargetKey: string | null = null;

  private dragContext: {
    key: string;
    pointerId: number;
    ghost: HTMLElement;
    offsetX: number;
    offsetY: number;
  } | null = null;


  static baseStyles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      font-weight: 600;
      color: #475569;
      user-select: none;
      min-height: 0;
    }

    .header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 0.5rem;
    }

    .title {
      font-size: 1.25rem;
      margin: 0;
      flex: 1;
    }

    .date-range {
      font-size: 0.75rem;
      font-weight: 500;
      color: #94a3b8;
      text-align: right;
      white-space: nowrap;
    }

    .agenda {
      margin-top: 0.75rem;
      display: flex;
      flex-direction: column;
      gap: 0;
      font-weight: 400;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      overflow-x: hidden;
      padding-right: 0.25rem;
    }

    .date-line.drop-target {
      background: #dbeafe;
      border: 1px solid #1d4ed8;
    }

    .date-line.dragging-source {
      opacity: 0;
    }

    .date-line {
      display: flex;
      justify-content: flex-start;
      gap: 0.35rem;
      align-items: baseline;
      padding: 1px 0.5rem;
      border-radius: 6px;
      border: 1px solid transparent;
      cursor: pointer;
      transition: background 0.15s ease;
      position: relative;
      overflow: visible;
    }

    .date-line .indicator-slots {
      overflow: visible;
    }

    .date-line .indicator-slot {
      overflow: visible;
    }

    .date-line:hover {
      background: #e0e7ff;
    }

    .line-controls {
      position: absolute;
      left: 0.35rem;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }

    .drag-hint {
      display: flex;
      align-items: center;
      justify-content: center;
      opacity: 0;
      transition: opacity 0.15s ease;
      pointer-events: auto;
      background: transparent;
    }

    .date-line.hovered .drag-hint {
      opacity: 1;
    }

    .date-line.focused {
      background: #c7d2fe;
    }

    .date-line.incoming-activity-drop {
      border: 1px dashed #fb923c;
      background: #fff7ed;
    }

    .date-line.date-marked {
      background: #e8f8e5;
      border-color: #bbf7d0;
    }

    .date-line.date-marked .date,
    .date-line.date-marked .notation {
      color: #14532d;
    }

    .mark-badge {
      min-width: 18px;
      height: 18px;
      padding: 0 4px;
      border-radius: 999px;
      background: #86efac;
      color: #0f172a;
      font-size: 0.7rem;
      font-weight: 700;
      display: flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
      pointer-events: auto;
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.2);
    }

    .date {
      color: #0f172a;
      white-space: pre;
      font-weight: 600;
      display: inline-block;
      font-family: "Courier New", Courier, monospace;
      font-size: 0.8em;
      min-width: 80px;
      padding-left: 1.25rem;
    }

    .notation-area {
      flex: 1;
      position: relative;
      display: block;
      min-width: 0;
      overflow: hidden;
    }

    .notation {
      white-space: nowrap;
      pointer-events: auto;
      cursor: grab;
      touch-action: none;
      overflow: hidden;
      text-overflow: ellipsis;
      text-align: left;
      font-family: "Segoe UI", Arial, sans-serif;
      display: block;
    }

    .date-line.dragging .drag-hint {
      opacity: 1;
      cursor: grabbing;
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
      transform: scale(0.8, 0.75);
      font-size: 0.8em;
    }

    .undated-line {
      font-size: 0.95rem;
      color: #0f172a;
    }

    .empty {
      font-style: italic;
      color: #94a3b8;
      font-weight: 400;
    }
  `;

  static styles = [PanelPlan.baseStyles, indicatorSlotStyles];

  render() {
    const displayTitle = this.title?.trim() || "Untitled Trip";
    const dateRange = this.getDateRangeLabel();

    return html`
      <div class="header">
        <h2 class="title">${displayTitle}</h2>
        ${dateRange ? html`<span class="date-range">${dateRange}</span>` : null}
      </div>
      <div class="agenda">
        ${this.lines.length === 0
          ? html`<p class="empty">No activities yet.</p>`
          : this.lines.map((line, index) =>
              line.kind === "dated"
                ? this.renderDatedLine(line as Extract<PlanLine, { kind: "dated" }>)
                : html`<div class="undated-line" data-index=${index}>
                  • ${line.label}
                  </div>`
            )}
      </div>
    `;
  }

  private handleDateClick(event: MouseEvent, line: PlanLine) {
    if (line.kind !== "dated") {
      return;
    }

      if (event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        this.dispatchEvent(
          new CustomEvent("plan-date-range-mark", {
            detail: { date: line.date },
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
        new CustomEvent("plan-date-toggle-mark", {
          detail: { date: line.date, mark: !line.isDateMarked },
          bubbles: true,
          composed: true
        })
      );
      return;
    }

    this.dispatchEvent(
      new CustomEvent("plan-date-focused", {
        detail: { line },
        bubbles: true,
        composed: true
      })
    );
  }

  private getDateRangeLabel(): string | null {
    const datedLines = this.lines
      .filter((line): line is Extract<PlanLine, { kind: "dated" }> => line.kind === "dated")
      .map((line) => {
        const parsed = parseFlexibleDate(line.date);
        if (!parsed) {
          return null;
        }
        return { line, timestamp: parsed.getTime(), year: parsed.getFullYear() };
      })
      .filter(
        (entry): entry is { line: Extract<PlanLine, { kind: "dated" }>; timestamp: number; year: number } =>
          entry !== null
      )
      .sort((a, b) => a.timestamp - b.timestamp);

    if (!datedLines.length) {
      return null;
    }

    const first = datedLines[0];
    const last = datedLines[datedLines.length - 1];
    const yearsDiffer = first.year !== last.year;
    const format = (entry: typeof first) =>
      yearsDiffer ? `${entry.line.displayDate} ${entry.year}` : entry.line.displayDate;

    if (first.line.date === last.line.date) {
      return format(first);
    }

    return `${format(first)} – ${format(last)}`;
  }

  protected updated(changedProps: PropertyValues<this>) {
    super.updated(changedProps);
    if ((changedProps.has("focusedKey") || changedProps.has("lines")) && this.focusedKey) {
      this.ensureFocusedDateVisible();
    }
  }

  private ensureFocusedDateVisible() {
    const container = this.renderRoot.querySelector<HTMLElement>(".agenda");
    if (!container || !this.focusedKey) {
      return;
    }
    const key = this.focusedKey;
    const escapedKey = typeof CSS !== "undefined" && CSS.escape ? CSS.escape(key) : key.replace(/"/g, '\"');
    const selector = `.date-line[data-key="${escapedKey}"]`;
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
    // Keep focused plan row within the scroll frame so first visit highlights correctly.
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  private setHoveredKey(key: string | null) {
    this.hoveredKey = key;
  }

  private buildDateLineClasses(line: Extract<PlanLine, { kind: "dated" }>): string {
    const classes = ["date-line"];
    if (line.date === this.focusedKey) {
      classes.push("focused");
    }
    if (line.date === this.hoveredKey) {
      classes.push("hovered");
    }
    if (line.date === this.dropTargetKey) {
      classes.push("drop-target");
    }
    if (line.date === this.draggingKey) {
      classes.push("dragging", "dragging-source");
    }
    if (this.incomingActivityDrag?.dateKey === line.date) {
      classes.push("incoming-activity-drop");
    }
    if (line.isDateMarked) {
      classes.push("date-marked");
    }
    return classes.join(" ");
  }

  private renderGripIcon() {
    return html`<svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke-width="1.5"
      stroke="currentColor"
      width="16"
      height="16"
    >
      <path stroke-linecap="round" stroke-linejoin="round" d="M3.75 9h16.5m-16.5 6.75h16.5" />
    </svg>`;
  }

  public getDateInfoAtPoint(clientX: number, clientY: number): { key: string; display: string } | null {
    const root = this.shadowRoot;
    if (!root) {
      return null;
    }
    // NOTE: highlight is offset by panel-left padding-top (16px). Leaving as-is until layout fix.
    const rect = this.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    if (localX < 0 || localY < 0 || localX > rect.width || localY > rect.height) {
      return null;
    }
    const localTarget = root.elementFromPoint(localX, localY);
    console.debug("[panel-plan] getDateInfoAtPoint target", {
      tag: localTarget instanceof HTMLElement ? localTarget.tagName : localTarget?.constructor?.name,
      localX,
      localY
    });
    const row = localTarget?.closest?.(".date-line") as HTMLElement | null;
    if (!row) {
      console.debug("[panel-plan] getDateInfoAtPoint miss row");
      return null;
    }
    const key = row.getAttribute("data-key");
    if (!key) {
      console.debug("[panel-plan] getDateInfoAtPoint missing data-key");
      return null;
    }
    const dateText = row.querySelector<HTMLElement>(".date")?.textContent?.trim() ?? "";
    return { key, display: dateText };
  }

  private renderDatedLine(line: Extract<PlanLine, { kind: "dated" }>) {
    const notation = line.notation && line.notation.trim().length > 0 ? line.notation : buildNotation(line.activities);
    const hoverDisplay =
      this.hoveredKey === line.date && line.activities.length > 0
        ? this.formatActivityCount(line.activities.length)
        : notation;
    return html`<div
      class=${this.buildDateLineClasses(line)}
      data-key=${line.date}
      @click=${(event: MouseEvent) => this.handleDateClick(event, line)}
      @mouseenter=${() => this.setHoveredKey(line.date)}
      @mouseleave=${() => this.setHoveredKey(null)}
    >
      <span class="line-controls">${this.renderLineControl(line)}</span>
      <span class="date">${line.displayDate}</span>
      <div class="notation-area">
        <span class="notation" title=${hoverDisplay}>${hoverDisplay}</span>
      </div>
      ${this.renderIndicatorSlots(line)}
    </div>`;
  }

  private renderIndicatorSlots(line: Extract<PlanLine, { kind: "dated" }>) {
    return html`<div class="indicator-slots">
      ${renderDayIndicatorSlots({
        flightCount: line.flightCount ?? 0,
        flightBooked: line.flightBooked ?? false,
        hasRentalCar: line.hasRentalCar ?? false,
        rentalCarBooked: line.rentalCarBooked ?? false,
        lodgingStatus: line.lodgingStatus ?? "none",
        lodgingCity: line.lodgingCity,
        lodgingStartsHere: line.lodgingStartsHere ?? false,
        lodgingEndsHere: line.lodgingEndsHere ?? false,
        mealCount: line.mealCount ?? 0,
        mealsNeedingReservation: line.mealsNeedingReservation ?? 0,
        hasDateMismatchIssue: line.hasDateMismatchIssue ?? false,
        issueNoTransportToLodging: line.issueNoTransportToLodging ?? false,
        issueNoTransportToFlight: line.issueNoTransportToFlight ?? false,
      })}
    </div>`;
  }

  private formatActivityCount(count: number): string {
    return count === 1 ? "1 activity" : `${count} activities`;
  }

  private renderLineControl(line: Extract<PlanLine, { kind: "dated" }>) {
    const count = line.markedCount ?? 0;
    if (count > 0) {
      const title = this.formatMarkedActivityCount(count);
      return html`<span
        class="mark-badge"
        role="button"
        aria-label=${title}
        title=${title}
        @pointerdown=${(event: PointerEvent) => this.handleDragHandlePointerDown(event, line)}
      >
        ${count}
      </span>`;
    }
    return html`<span
      class="drag-hint"
      role="button"
      aria-label="Drag day"
      @pointerdown=${(event: PointerEvent) => this.handleDragHandlePointerDown(event, line)}
    >
      ${this.renderGripIcon()}
    </span>`;
  }

  private formatMarkedActivityCount(count: number): string {
    return count === 1 ? "1 marked activity" : `${count} marked activities`;
  }


  private handleDragHandlePointerDown(event: PointerEvent, line: Extract<PlanLine, { kind: "dated" }>) {
    event.preventDefault();
    event.stopPropagation();
    const row = (event.currentTarget as HTMLElement).closest<HTMLElement>(".date-line");
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
      key: line.date,
      pointerId: event.pointerId,
      ghost,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top
    };
    this.draggingKey = line.date;
    this.dropTargetKey = line.date;
    this.updateGhostDateForKey(line.date);
    console.log("[panel-plan] drag start", line.date);
    window.addEventListener("pointermove", this.handleGlobalPointerMove, true);
    window.addEventListener("pointerup", this.handleGlobalPointerUp, true);
    window.addEventListener("pointercancel", this.handleGlobalPointerCancel, true);
    window.addEventListener("keydown", this.handleGlobalKeyDown, true);
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
    const row = localTarget?.closest?.(".date-line") as HTMLElement | null;
    const key = row?.getAttribute("data-key") ?? null;
    if (key !== this.dropTargetKey) {
      this.dropTargetKey = key;
      this.updateGhostDateForKey(key);
    }
  };

  private handleGlobalPointerUp = (event: PointerEvent) => {
    if (!this.dragContext || event.pointerId !== this.dragContext.pointerId) {
      return;
    }
    event.preventDefault();
    const fromKey = this.dragContext.key;
    const toKey = this.dropTargetKey;
    const commit = Boolean(toKey && toKey !== fromKey);
    this.finishDrag();
    if (commit && toKey) {
      this.dispatchEvent(
        new CustomEvent("plan-date-move", {
          detail: { fromKey, toKey },
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

  private updateGhostDateForKey(key: string | null) {
    if (!key || !this.dragContext) {
      return;
    }
    const ghostDate = this.dragContext.ghost.querySelector<HTMLElement>(".date");
    if (!ghostDate) {
      return;
    }
    const targetLine = this.lines.find(
      (line): line is Extract<PlanLine, { kind: "dated" }> => line.kind === "dated" && line.date === key
    );
    if (!targetLine) {
      return;
    }
    ghostDate.textContent = targetLine.displayDate;
  }

  private finishDrag() {
    if (this.dragContext) {
      this.dragContext.ghost.remove();
    }
    this.dragContext = null;
    this.draggingKey = null;
    this.dropTargetKey = null;
    window.removeEventListener("pointermove", this.handleGlobalPointerMove, true);
    window.removeEventListener("pointerup", this.handleGlobalPointerUp, true);
    window.removeEventListener("pointercancel", this.handleGlobalPointerCancel, true);
    window.removeEventListener("keydown", this.handleGlobalKeyDown, true);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "panel-plan": PanelPlan;
  }
}
