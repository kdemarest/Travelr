import { LitElement, PropertyValues, css, html } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { customElement, property, state } from "lit/decorators.js";
import type { DayEntry } from "../view/view-day";

type PlanPanelElement = HTMLElement & {
  getDateInfoAtPoint?: (clientX: number, clientY: number) => { key: string; display: string } | null;
};

@customElement("panel-day")
export class PanelDay extends LitElement {
  @property({ type: String }) title = "Day";
  @property({ attribute: false }) items: DayEntry[] = [];
  @property({ type: String }) selectedUid: string | null = null;
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

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: 0;
      font-family: inherit;
      color: #0f172a;
    }

    .title {
      margin: 0 0 0.5rem 0;
      font-size: 1.15rem;
      font-weight: 600;
      color: #0f172a;
    }

    .empty {
      font-style: italic;
      color: #94a3b8;
      margin: 0;
    }

    .list {
      flex: 1;
        gap: 0;
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

      .activity:last-child {
        margin-bottom: 0;
      }

      border: 1px solid transparent;
      position: relative;
    }

    .activity:focus-visible,
    .activity:hover {
      background: #eef2ff;
    }

    .activity.selected {
      background: #e0e7ff;
      border-color: #818cf8;
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
  `;

  render() {
    return html`
      <h3 class="title">${this.title}</h3>
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
    if ((changedProps.has("selectedUid") || changedProps.has("items")) && this.selectedUid) {
      this.ensureSelectedActivityVisible();
    }
  }

  private ensureSelectedActivityVisible() {
    const container = this.renderRoot.querySelector<HTMLElement>(".list");
    if (!container || !this.selectedUid) {
      return;
    }
    const uid = this.selectedUid;
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
    // Keep selected day activity in view so navigation feels consistent on initial load.
    row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  private renderActivityRow(item: DayEntry, index: number) {
    const activity = item.activity;
    if (!activity) {
      return null;
    }
    const isSelected = this.selectedUid === activity.uid;
    return html`<div
      class=${classMap(this.buildActivityClasses({ index, uid: activity.uid, selected: isSelected }))}
      data-index=${index}
      data-time=${item.time}
      data-uid=${activity.uid}
      tabindex="0"
      @mouseenter=${() => this.emitActivityHover(activity)}
      @focus=${() => this.emitActivityHover(activity)}
      @click=${() => this.emitActivitySelect(activity)}
      @keydown=${(event: KeyboardEvent) => this.handleKey(event, activity)}
      aria-selected=${isSelected}
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
    </div>`;
  }

  private buildActivityClasses(options: { index: number; uid?: string | null; selected?: boolean; placeholder?: boolean }) {
    return {
      activity: true,
      placeholder: Boolean(options.placeholder),
      selected: Boolean(options.selected),
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

  private emitActivitySelect(activity: DayEntry["activity"]) {
    this.dispatchEvent(
      new CustomEvent("day-activity-select", {
        detail: { activity },
        bubbles: true,
        composed: true
      })
    );
  }

  private handleKey(event: KeyboardEvent, activity: DayEntry["activity"]) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      this.emitActivitySelect(activity);
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
