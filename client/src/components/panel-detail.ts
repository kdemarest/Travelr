import { LitElement, PropertyValues, css, html } from "lit";
import { classMap } from "lit/directives/class-map.js";

export type PanelDetailLogEntry =
  | { id: string; kind: "text"; text: string; isUser?: boolean }
  | { id: string; kind: "search"; summary: string; snippets: string[] };

const PENDING_TIMEOUT_MS = 4000;

export class PanelDetail extends LitElement {
  static styles = css`
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
  `;

  static properties = {
    messages: { type: Array },
    serverBusy: { type: Boolean },
    draft: { state: true },
    pending: { state: true }
  } as const;

  messages: PanelDetailLogEntry[] = [];
  serverBusy = false;
  draft = "";
  pending = false;

  private pendingTimeout?: number;
  private logEl?: HTMLDivElement;
  private expandedEntries = new Set<string>();

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
    }

    if (changed.has("serverBusy") && !this.serverBusy) {
      this.clearPending();
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
      return html`<div class=${classMap(classes)}>${entry.text}</div>`;
    }
    const expanded = this.expandedEntries.has(entry.id);
    return html`
      <div class="search-entry">
        <button class="search-toggle" @click=${() => this.toggleEntry(entry.id)}>
          <span class="search-chevron">${expanded ? "▼" : "▶"}</span>
          <span>${entry.summary}</span>
        </button>
        ${expanded
          ? html`<ol class="search-results">
              ${entry.snippets.map((snippet, index) => html`<li>${index + 1}. ${snippet}</li>`) }
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
}

declare global {
  interface HTMLElementTagNameMap {
    "panel-detail": PanelDetail;
  }
}

if (!customElements.get("panel-detail")) {
  customElements.define("panel-detail", PanelDetail);
}
