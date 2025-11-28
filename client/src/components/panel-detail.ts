import { LitElement, PropertyValues, css, html } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { dateLinkStyles, renderTextWithDateLinks } from "../date-link";
import { parseCanonicalCommand } from "../command-parse";
import type { Activity } from "../types";
import { formatMonthDayLabel } from "../datetime";

export type PanelDetailLogEntry =
  | { id: string; kind: "text"; text: string; isUser?: boolean }
  | { id: string; kind: "search"; summary: string; snippets: string[] };

type LinkMarkup = {
  type: "activity" | "date";
  value: string;
  label: string;
};

type CommandRenderContext = {
  entryId: string;
  nextIndex: number;
};

const PENDING_TIMEOUT_MS = 4000;

export class PanelDetail extends LitElement {
  static styles = [css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 0.75rem;
      color: #0f172a;
      font-family: inherit;
    }

    .log {
      flex: 1;
      overflow-y: auto;
      padding: 0.75rem;
      border: 1px solid #cbd5f5;
      border-radius: 8px;
      background: transparent;
    }

    .log-line {
      font-size: 0.9rem;
      margin-bottom: 0.3rem;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .user-message {
      background: #eef2ff;
      border-radius: 6px;
      padding: 0.25rem 0.4rem;
      display: inline-block;
    }

    .link-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      padding: 0.02rem 0.25rem;
      margin: 0 0.05rem;
      border-radius: 4px;
      border: 1px solid #94a3b8;
      background: #fff;
      font-size: 0.75rem;
      line-height: 1.1;
      vertical-align: middle;
      cursor: pointer;
      color: #0f172a;
    }

    .link-chip:hover {
      border-color: #1d4ed8;
      color: #1d4ed8;
    }

    .command-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      padding: 0.1rem 0.4rem;
      margin: 0.1rem 0.2rem 0.1rem 0;
      border-radius: 6px;
      border: 1px solid #d4b5ff;
      background: #f6f0ff;
      font-size: 0.8rem;
      line-height: 1.1;
      cursor: pointer;
      color: #0f172a;
    }

    .command-chip:hover,
    .command-chip:focus-visible {
      border-color: #a855f7;
      background: #ede3ff;
      outline: none;
    }

    .command-chip-wrapper {
      display: inline-flex;
      align-items: center;
      gap: 0.35rem;
      margin: 0.1rem 0.3rem 0.1rem 0;
      flex-wrap: wrap;
    }

    .command-full-text {
      font-family: Consolas, "Courier New", monospace;
      font-size: 0.8rem;
      border: 1px dashed #cbd5f5;
      border-radius: 4px;
      padding: 0.05rem 0.35rem;
      background: #fff;
      color: #1e293b;
      white-space: pre-wrap;
      display: inline-block;
      padding-left: 0.75rem;
      text-indent: -0.75rem;
    }

    .search-entry {
      border: 1px solid #cbd5f5;
      border-radius: 6px;
      padding: 0.2rem 0.45rem;
      background: #fff;
      margin-bottom: 0.25rem;
      font-size: 0.7rem;
      line-height: 1.25;
    }

    .search-toggle {
      display: flex;
      align-items: center;
      gap: 0.3rem;
      width: 100%;
      border: none;
      background: transparent;
      padding: 0;
      font: inherit;
      text-align: left;
      cursor: pointer;
      color: #0f172a;
    }

    .search-toggle:hover {
      color: #1d4ed8;
    }

    .search-chevron {
      width: 1rem;
      text-align: center;
      font-size: 0.9rem;
    }

    .search-results {
      margin: 0.35rem 0 0;
      padding-left: 1rem;
      font-size: 0.75rem;
      color: #0f172a;
    }

    form {
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
    }

    textarea {
      width: 100%;
      min-height: 80px;
      padding: 0.75rem;
      border-radius: 8px;
      border: 1px solid #cbd5f5;
      font-family: inherit;
      font-size: 0.95rem;
      resize: vertical;
      box-sizing: border-box;
    }

    .form-actions {
      display: flex;
      align-items: center;
      gap: 0.5rem;
    }

    .actions-left {
      display: flex;
      align-items: center;
      gap: 0.35rem;
    }

    .icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 34px;
      height: 34px;
      border: 1px solid #cbd5f5;
      border-radius: 6px;
      background: white;
      color: #0f172a;
      cursor: pointer;
      padding: 0;
    }

    .submit-button {
      margin-left: auto;
      padding: 0.5rem 1.25rem;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 6px;
      font-weight: 600;
      cursor: pointer;
    }

    .submit-button:disabled,
    .icon-button:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `, dateLinkStyles];

  static properties = {
    messages: { type: Array },
    serverBusy: { type: Boolean },
    activities: { type: Array },
    draft: { state: true },
    pending: { state: true }
  } as const;

  messages: PanelDetailLogEntry[] = [];
  serverBusy = false;
  activities: Activity[] = [];
  draft = "";
  pending = false;

  private pendingTimeout?: number;
  private logEl?: HTMLDivElement;
  private expandedEntries = new Set<string>();
  private expandedCommandKeys = new Set<string>();
  private activityByUid = new Map<string, Activity>();

  protected updated(changed: PropertyValues<PanelDetail>) {
    this.logEl = this.renderRoot?.querySelector<HTMLDivElement>(".log") ?? undefined;
    if (changed.has("messages")) {
      this.logEl?.scrollTo({ top: this.logEl.scrollHeight });
      const ids = new Set(this.messages.map((entry) => entry.id));
      for (const id of Array.from(this.expandedEntries)) {
        if (!ids.has(id)) {
          this.expandedEntries.delete(id);
        }
      }
      for (const key of Array.from(this.expandedCommandKeys)) {
        const keyId = key.split(":", 1)[0];
        if (!ids.has(keyId)) {
          this.expandedCommandKeys.delete(key);
        }
      }
    }

    if (changed.has("serverBusy") && !this.serverBusy) {
      this.clearPending();
    }

    if (changed.has("activities")) {
      this.activityByUid.clear();
      for (const activity of this.activities ?? []) {
        if (activity?.uid) {
          this.activityByUid.set(activity.uid, activity);
        }
      }
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.clearPendingTimeout();
  }

  private handleInput(event: Event) {
    this.draft = (event.target as HTMLTextAreaElement).value;
  }

  private handleKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      this.submitDraft();
    }
  }

  private handleSubmit(event: Event) {
    event.preventDefault();
    this.submitDraft();
  }

  private submitDraft() {
    const text = this.draft.trim();
    if (!text || this.pending) {
      return;
    }

    this.dispatchCommand(text);
    this.draft = "";
  }

  private handleUndoClick() {
    this.dispatchCommand("/undo");
  }

  private handleRedoClick() {
    this.dispatchCommand("/redo");
  }

  private dispatchCommand(text: string) {
    if (this.pending) {
      return;
    }
    this.startPendingWindow();
    this.dispatchEvent(
      new CustomEvent("panel-detail-submit", {
        bubbles: true,
        composed: true,
        detail: { text }
      })
    );
  }

  private startPendingWindow() {
    this.pending = true;
    this.clearPendingTimeout();
    this.pendingTimeout = window.setTimeout(() => {
      this.pending = false;
      this.pendingTimeout = undefined;
      this.requestUpdate();
    }, PENDING_TIMEOUT_MS);
  }

  private clearPending() {
    this.clearPendingTimeout();
    if (this.pending) {
      this.pending = false;
    }
  }

  private clearPendingTimeout() {
    if (this.pendingTimeout !== undefined) {
      window.clearTimeout(this.pendingTimeout);
      this.pendingTimeout = undefined;
    }
  }

  private toggleEntry(entryId: string) {
    if (this.expandedEntries.has(entryId)) {
      this.expandedEntries.delete(entryId);
    } else {
      this.expandedEntries.add(entryId);
    }
    this.requestUpdate();
  }

  private renderLogEntry(entry: PanelDetailLogEntry) {
    if (entry.kind === "text") {
      const classes = { "log-line": true, "user-message": Boolean(entry.isUser) };
      return html`<div class=${classMap(classes)}>${this.renderTextWithLinks(entry.text, entry.id)}</div>`;
    }
    const expanded = this.expandedEntries.has(entry.id);
    return html`
      <div class="search-entry">
        <button class="search-toggle" @click=${() => this.toggleEntry(entry.id)}>
          <span class="search-chevron">${expanded ? "▼" : "▶"}</span>
          <span>${this.renderDateLinkedTextNode(entry.summary)}</span>
        </button>
        ${expanded
          ? html`<ol class="search-results">
              ${entry.snippets.map((snippet, index) => html`<li>${index + 1}. ${this.renderDateLinkedTextNode(snippet)}</li>`) }
            </ol>`
          : null}
      </div>
    `;
  }

  render() {
    return html`
      <div class="log">
        ${this.messages.map((entry) => this.renderLogEntry(entry)) }
      </div>
      <form @submit=${this.handleSubmit}>
        <textarea
          placeholder="Enter free-form notes or slash-commands"
          .value=${this.draft}
          @input=${this.handleInput}
          @keydown=${this.handleKeyDown}
        ></textarea>
        <div class="form-actions">
          <div class="actions-left">
            <button
              type="button"
              class="icon-button"
              aria-label="Undo"
              @click=${this.handleUndoClick}
              ?disabled=${this.pending}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="size-6"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
              </svg>
            </button>
            <button
              type="button"
              class="icon-button"
              aria-label="Redo"
              @click=${this.handleRedoClick}
              ?disabled=${this.pending}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                stroke-width="1.5"
                stroke="currentColor"
                class="size-6"
              >
                <path stroke-linecap="round" stroke-linejoin="round" d="m15 15 6-6m0 0-6-6m6 6H9a6 6 0 0 0 0 12h3" />
              </svg>
            </button>
          </div>
          <button type="submit" class="submit-button" ?disabled=${this.pending}>Send</button>
        </div>
      </form>
    `;
  }

  private renderTextWithLinks(text: string, entryId?: string) {
    const segments: Array<ReturnType<typeof html>> = [];
    const regex = /<<(?:link|select)\s+([^>]+)>>/gi;
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;
    const commandContext = entryId ? { entryId, nextIndex: 0 } : undefined;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        this.pushDecoratedText(segments, text.slice(lastIndex, match.index), commandContext);
      }

      const markup = this.parseLinkMarkup(match[1]);
      if (markup) {
        segments.push(
          html`<button type="button" class="link-chip" @click=${() => this.handleLinkMarkup(markup)}>${markup.label}</button>`
        );
      } else {
        this.pushDecoratedText(segments, match[0], commandContext);
      }

      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      this.pushDecoratedText(segments, text.slice(lastIndex), commandContext);
    }

    return segments;
  }

  private parseLinkMarkup(raw: string): LinkMarkup | null {
    const attrRegex = /(type|uid|value|label)="([^"]*)"/gi;
    const attrs = new Map<string, string>();
    let match: RegExpExecArray | null = null;
    while ((match = attrRegex.exec(raw)) !== null) {
      attrs.set(match[1].toLowerCase(), match[2]);
    }

    const type = attrs.get("type");
    if (type !== "activity" && type !== "date") {
      return null;
    }

    const label = attrs.get("label")?.trim();
    if (!label) {
      return null;
    }

    if (type === "activity") {
      const uid = attrs.get("uid")?.trim();
      if (!uid) {
        return null;
      }
      return { type, value: uid, label };
    }

    const value = attrs.get("value")?.trim();
    if (!value) {
      return null;
    }
    return { type, value, label };
  }

  private handleLinkMarkup(markup: LinkMarkup) {
    this.dispatchEvent(
      new CustomEvent("panel-detail-link", {
        bubbles: true,
        composed: true,
        detail: markup
      })
    );
  }

  private pushDecoratedText(
    target: Array<ReturnType<typeof html>>,
    text: string,
    commandContext?: CommandRenderContext
  ) {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      const trimmed = line.trimStart();
      if (trimmed.startsWith("/")) {
        const key = commandContext ? `${commandContext.entryId}:${commandContext.nextIndex++}` : undefined;
        target.push(this.renderCommandChip(trimmed, key));
      } else if (line.length) {
        this.renderDateLinkedTextSegments(line).forEach((segment) => {
          if (typeof segment === "string") {
            target.push(html`${segment}`);
          } else {
            target.push(segment);
          }
        });
      }
      if (index < lines.length - 1) {
        target.push(html`\n`);
      }
    });
  }

  private renderDateLinkedTextNode(text: string | null | undefined) {
    const segments = this.renderDateLinkedTextSegments(text);
    return html`${segments}`;
  }

  private renderDateLinkedTextSegments(text: string | null | undefined) {
    const value = text ?? "";
    return renderTextWithDateLinks(value, (date) => this.emitDateLink(date));
  }

  private renderCommandChip(command: string, key?: string) {
    const expanded = key ? this.expandedCommandKeys.has(key) : false;
    const labelText = this.buildCommandChipLabel(command);
    const parsed = parseCanonicalCommand(command);
    const commandUid = parsed?.args.uid ?? null;
    const button = html`<button
      type="button"
      class="command-chip"
      title=${command}
      @click=${() => this.handleCommandChipToggle(key, commandUid)}
    >${labelText}</button>`;
    if (!key) {
      return button;
    }
    return html`<span class="command-chip-wrapper">
      ${button}
      ${expanded ? html`<span class="command-full-text">${this.renderCommandFullText(command)}</span>` : null}
    </span>`;
  }

  private renderCommandFullText(command: string) {
    const formatted = command.replace(/\s+(?=[A-Za-z0-9_-]+=(?:"(?:\\.|[^"])*"|\S)+)/g, "\n");
    return this.renderDateLinkedTextNode(formatted);
  }

  private handleCommandChipToggle(key?: string, activityUid?: string | null) {
    if (!key) {
      return;
    }
    if (this.expandedCommandKeys.has(key)) {
      this.expandedCommandKeys.delete(key);
    } else {
      this.expandedCommandKeys.add(key);
      if (activityUid) {
        this.dispatchEvent(
          new CustomEvent("panel-command-activity-select", {
            bubbles: true,
            composed: true,
            detail: { uid: activityUid }
          })
        );
      }
    }
    this.requestUpdate();
  }

  private buildCommandChipLabel(commandLine: string): string {
    const trimmed = commandLine.trim();
    if (!trimmed.startsWith("/")) {
      return this.clipCommandLabel(trimmed);
    }
    const parsed = parseCanonicalCommand(trimmed);
    if (!parsed) {
      return this.clipCommandLabel(trimmed);
    }
    const command = parsed.keyword;
    const lowered = command.toLowerCase();
    if (lowered === "/delete") {
      const uid = parsed.args.uid;
      const label = [command, uid].filter(Boolean).join(" ").trim() || command;
      return this.clipCommandLabel(label);
    }
    if (lowered === "/add" || lowered === "/edit") {
      const context = this.resolveCommandActivityContext(parsed);
      const rawDate = context.date ?? null;
      const formattedDate = this.formatChipDate(rawDate);
      const name = context.name ?? undefined;
      const pieces = [command];
      if (formattedDate) {
        pieces.push(formattedDate);
      } else if (rawDate) {
        pieces.push(rawDate);
      }
      if (name) {
        pieces.push(name);
      }
      const label = pieces.join(" ").trim() || command;
      return this.clipCommandLabel(label);
    }
    return this.clipCommandLabel(trimmed);
  }

  private resolveCommandActivityContext(parsed: ReturnType<typeof parseCanonicalCommand>): {
    date: string | null;
    name: string | null;
  } {
    const directDate = parsed?.args.date ?? null;
    const directName = parsed?.args.name ?? null;
    const uid = parsed?.args.uid;
    if (!uid) {
      return { date: directDate, name: directName };
    }
    const activity = this.activityByUid.get(uid);
    return {
      date: directDate ?? activity?.date ?? null,
      name: directName ?? activity?.name ?? null
    };
  }

  private formatChipDate(raw: string | null): string | null {
    return formatMonthDayLabel(raw, { month: "short", day: "2-digit" });
  }

  private clipCommandLabel(label: string): string {
    if (label.length <= 30) {
      return label;
    }
    return `${label.slice(0, 27).trimEnd()}…`;
  }

  private emitDateLink(date: string) {
    this.dispatchEvent(
      new CustomEvent("panel-date-link-click", {
        bubbles: true,
        composed: true,
        detail: { date }
      })
    );
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "panel-detail": PanelDetail;
  }
}

if (!customElements.get("panel-detail")) {
  customElements.define("panel-detail", PanelDetail);
}
