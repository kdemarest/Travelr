import { LitElement, PropertyValues, css, html } from "lit";
import { classMap } from "lit/directives/class-map.js";
import { unsafeHTML } from "lit/directives/unsafe-html.js";
import { marked } from "marked";
import { dateLinkStyles, renderTextWithDateLinks } from "../date-link";
import { parseCanonicalCommand } from "../command-parse";
import type { Activity } from "../types";
import { formatMonthDayLabel } from "../datetime";
import { clientDataCache } from "../client-data-cache";

export type PanelDetailLogEntry =
  | { id: string; kind: "text"; text: string; isUser?: boolean; pending?: boolean }
  | { id: string; kind: "search"; summary: string; snippets: string[] };

type LinkMarkup = {
  type: "activity" | "date";
  value: string;
  label: string;
};

type MessageBlock =
  | { type: "text"; text: string }
  | { type: "command"; lines: string[] };

type IntentGroup = {
  intentWhat: string;
  part: number;
  commands: string[];
};

type RenderSegment =
  | { type: "text"; text: string }
  | { type: "commands"; lines: string[] }  // ungrouped commands (before any intent)
  | { type: "intent-group"; group: IntentGroup };

const PENDING_TIMEOUT_MS = 4000;
const LINK_MARKUP_PATTERN = /<<(?:link|select)\s+([^>]+)>>/gi;
const DATE_TEXT_PATTERN = /\b\d{4}-\d{2}-\d{2}\b/;

marked.setOptions({
  breaks: true,
  gfm: true
});

export class PanelDetail extends LitElement {
  static styles = [css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 0.75rem;
      color: #0f172a;
      font-family: inherit;
      overflow: hidden;
      min-width: 0;
    }

    .chat-log {
      flex: 1;
      overflow-y: auto;
      overflow-x: hidden;
      padding: 0.75rem;
      border: 1px solid #cbd5f5;
      border-radius: 8px;
      background: transparent;
      min-width: 0;
    }

    .chat-log-line {
      display: block;
      font-size: 0.9rem;
      margin-bottom: 0.3rem;
      word-break: break-word;
      white-space: normal;
      line-height: 1.4;
      min-width: 0;
      max-width: 100%;
    }

    .chat-log-line :where(p, ul, ol, pre, blockquote) {
      margin: 0 0 0.25rem;
      max-width: 100%;
    }

    .chat-log-line :where(p, ul, ol, pre, blockquote):last-child {
      margin-bottom: 0;
    }

    .chat-log-line :where(ul, ol) {
      padding-left: 1.2rem;
    }

    .chat-log-line code {
      font-family: Consolas, "Courier New", monospace;
      background: #f1f5f9;
      border-radius: 4px;
      padding: 0.05rem 0.3rem;
      font-size: 0.85rem;
    }

    .chat-log-line pre {
      background: #d3cebcff;
      border-radius: 6px;
      padding: 0.6rem;
      overflow-x: auto;
      font-size: 0.85rem;
      max-width: 400px;
    }

    .chat-log-line pre code {
      background: transparent;
      padding: 0;
    }

    .chat-log-line blockquote {
      border-left: 3px solid #cbd5f5;
      padding-left: 0.75rem;
      color: #475569;
    }

    .user-message {
      background: #eef2ff;
      border-radius: 6px;
      padding: 0.25rem 0.4rem;
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

    .pending-command .command-chip {
      opacity: 0.5;
      pointer-events: none;
    }

    .pending-command .command-full-text {
      opacity: 0.5;
    }

    .intent-group {
      display: inline-flex;
      flex-direction: column;
      margin: 0.1rem 0.2rem 0.1rem 0;
    }

    .intent-chip {
      display: inline-flex;
      align-items: center;
      gap: 0.2rem;
      padding: 0.15rem 0.5rem;
      border-radius: 6px;
      border: 1px solid #86efac;
      background: #f0fdf4;
      font-size: 0.8rem;
      line-height: 1.2;
      cursor: pointer;
      color: #166534;
    }

    .intent-chip:hover,
    .intent-chip:focus-visible {
      border-color: #22c55e;
      background: #dcfce7;
      outline: none;
    }

    .intent-chip .intent-chevron {
      font-size: 0.7rem;
      margin-right: 0.1rem;
    }

    .intent-commands {
      display: flex;
      flex-wrap: wrap;
      padding: 0.25rem 0 0 0.5rem;
      border-left: 2px solid #86efac;
      margin-left: 0.5rem;
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

    .submit-button.stop-button {
      background: #dc2626;
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
  private chatLogEl?: HTMLDivElement;
  private expandedEntries = new Set<string>();
  private expandedCommandKeys = new Set<string>();
  private expandedIntentKeys = new Set<string>();
  private activityByUid = new Map<string, Activity>();
  private readonly chatLogClickHandler = (event: Event) => this.handleChatLogClick(event);
  private readonly chatLogKeydownHandler = (event: KeyboardEvent) => this.handleChatLogKeydown(event);

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("click", this.chatLogClickHandler);
    this.addEventListener("keydown", this.chatLogKeydownHandler);
  }

  protected updated(changed: PropertyValues<PanelDetail>) {
    this.chatLogEl = this.renderRoot?.querySelector<HTMLDivElement>(".chat-log") ?? undefined;
    if (changed.has("messages")) {
      this.chatLogEl?.scrollTo({ top: this.chatLogEl.scrollHeight });
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
    this.removeEventListener("click", this.chatLogClickHandler);
    this.removeEventListener("keydown", this.chatLogKeydownHandler);
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

  private handleStopClick() {
    this.dispatchEvent(
      new CustomEvent("panel-detail-stop", {
        bubbles: true,
        composed: true
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

  private renderChatLogEntry(entry: PanelDetailLogEntry) {
    if (entry.kind === "text") {
      const classes = { "chat-log-line": true, "user-message": Boolean(entry.isUser) };
      return html`<div class=${classMap(classes)}>${this.renderTextWithLinks(entry.text, entry.id, entry.pending)}</div>`;
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
    // Get model info from clientDataCache
    const modelList = clientDataCache.get<string[]>("modelList") ?? [];
    const activeModel = clientDataCache.get<string>("activeModel") ?? "";
    const chatbotAvailable = clientDataCache.get<boolean>("chatbotAvailable");

    return html`
      <div style="position: relative; flex: 1; min-height: 0; display: flex; flex-direction: column;">
        <div style="position: absolute; top: 0; left: 0; z-index: 10; background: #fff; border: 1px solid #cbd5f5; border-radius: 6px; padding: 0.25rem 0.5rem; box-shadow: 0 1px 4px rgba(0,0,0,0.06);">
          <label style="font-size: 0.85em; font-weight: 500; margin-right: 0.25rem;">Chatbot:</label>
          <select
            style="font-size: 0.85em;"
            ?disabled=${chatbotAvailable === false}
            .value=${chatbotAvailable === false ? "unavailable" : activeModel}
          >
            ${chatbotAvailable === false
              ? html`<option value="unavailable">Unavailable</option>`
              : modelList.map(
                  (model) => html`<option value=${model} ?selected=${model === activeModel}>${model}</option>`
                )}
          </select>
        </div>
        <div class="chat-log" style="flex: 1; padding-top: 2.2rem;">
          ${this.messages.map((entry) => this.renderChatLogEntry(entry))}
        </div>
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
          ${this.serverBusy
            ? html`<button type="button" class="submit-button stop-button" @click=${this.handleStopClick}>Stop</button>`
            : html`<button type="submit" class="submit-button" ?disabled=${this.pending}>Send</button>`
          }
        </div>
      </form>
    `;
  }

  private renderTextWithLinks(text: string, entryId?: string, pending?: boolean) {
    const segments: Array<ReturnType<typeof html>> = [];
    const renderSegments = this.buildRenderSegments(text ?? "");
    let commandIndex = 0;
    let intentIndex = 0;

    for (const seg of renderSegments) {
      if (seg.type === "text" && seg.text.trim()) {
        segments.push(this.renderMarkdownBlock(seg.text));
      } else if (seg.type === "commands") {
        for (const line of seg.lines) {
          const key = entryId ? `${entryId}:cmd:${commandIndex++}` : undefined;
          segments.push(this.renderCommandChip(line, key, pending));
        }
      } else if (seg.type === "intent-group") {
        const key = entryId ? `${entryId}:intent:${intentIndex++}` : undefined;
        segments.push(this.renderIntentGroup(seg.group, key, pending));
      }
    }

    if (!segments.length) {
      segments.push(html``);
    }

    return segments;
  }

  private buildRenderSegments(text: string): RenderSegment[] {
    const blocks = this.splitMessageBlocks(text);
    const segments: RenderSegment[] = [];
    
    let currentIntent: string | null = null;
    let currentPart = 0;
    let currentCommands: string[] = [];
    
    const flushIntentGroup = () => {
      if (currentIntent && currentCommands.length > 0) {
        segments.push({
          type: "intent-group",
          group: {
            intentWhat: currentIntent,
            part: currentPart,
            commands: [...currentCommands]
          }
        });
        currentCommands = [];
        currentPart++;
      }
    };
    
    const flushUngroupedCommands = () => {
      if (!currentIntent && currentCommands.length > 0) {
        segments.push({ type: "commands", lines: [...currentCommands] });
        currentCommands = [];
      }
    };
    
    for (const block of blocks) {
      if (block.type === "text") {
        // Text always renders - flush any pending commands first
        flushIntentGroup();
        flushUngroupedCommands();
        if (block.text.trim()) {
          segments.push({ type: "text", text: block.text });
        }
      } else {
        // Command block
        for (const line of block.lines) {
          const parsed = parseCanonicalCommand(line);
          const isIntent = parsed?.keyword?.toLowerCase() === "/intent";
          
          if (isIntent) {
            // New intent - flush previous group
            flushIntentGroup();
            flushUngroupedCommands();
            currentIntent = parsed?.args?.what ?? "Intent";
            currentPart = 1;
            currentCommands = [];
          } else {
            // Regular command
            currentCommands.push(line);
          }
        }
      }
    }
    
    // Flush any remaining
    flushIntentGroup();
    flushUngroupedCommands();
    
    return segments;
  }

  private renderIntentGroup(group: IntentGroup, key?: string, pending?: boolean) {
    const expanded = key ? this.expandedIntentKeys.has(key) : false;
    const label = group.part > 1 
      ? `${group.intentWhat} (part ${group.part})`
      : group.intentWhat;
    const clippedLabel = this.clipIntentLabel(label);
    const chevron = expanded ? "▼" : "▶";
    const chipClasses = { "intent-chip": true, "pending-command": Boolean(pending) };
    
    return html`
      <span class="intent-group">
        <button
          type="button"
          class=${classMap(chipClasses)}
          title=${`${group.commands.length} command(s): ${label}`}
          @click=${() => this.handleIntentToggle(key)}
        ><span class="intent-chevron">${chevron}</span>${clippedLabel}</button>
        ${expanded ? html`
          <span class="intent-commands">
            ${group.commands.map((cmd, i) => {
              const cmdKey = key ? `${key}:${i}` : undefined;
              return this.renderCommandChip(cmd, cmdKey, pending);
            })}
          </span>
        ` : null}
      </span>
    `;
  }

  private handleIntentToggle(key?: string) {
    if (!key) return;
    if (this.expandedIntentKeys.has(key)) {
      this.expandedIntentKeys.delete(key);
    } else {
      this.expandedIntentKeys.add(key);
    }
    this.requestUpdate();
  }

  private clipIntentLabel(label: string): string {
    if (label.length <= 120) {
      return label;
    }
    return `${label.slice(0, 117).trimEnd()}…`;
  }

  private splitMessageBlocks(text: string): MessageBlock[] {
    const normalized = text.replace(/\r\n/g, "\n");
    const lines = normalized.split("\n");
    const blocks: MessageBlock[] = [];
    let textBuffer: string[] = [];
    let commandBuffer: string[] = [];

    const flushText = () => {
      if (!textBuffer.length) {
        return;
      }
      blocks.push({ type: "text", text: textBuffer.join("\n") });
      textBuffer = [];
    };

    const flushCommands = () => {
      if (!commandBuffer.length) {
        return;
      }
      blocks.push({ type: "command", lines: [...commandBuffer] });
      commandBuffer = [];
    };

    for (const line of lines) {
      const trimmed = line.trimStart();
      const isCommand = trimmed.startsWith("/");
      if (isCommand) {
        flushText();
        commandBuffer.push(trimmed);
      } else {
        flushCommands();
        textBuffer.push(line);
      }
    }

    flushText();
    flushCommands();

    return blocks;
  }

  private renderMarkdownBlock(text: string) {
    const htmlString = this.buildMarkdownHtml(text);
    if (!htmlString) {
      return html``;
    }
    return html`${unsafeHTML(htmlString)}`;
  }

  private buildMarkdownHtml(text: string): string {
    const normalized = text.replace(/\r\n/g, "\n");
    if (!normalized.trim()) {
      return "";
    }
    const { content, placeholders } = this.replaceLinkMarkupWithPlaceholders(normalized);
    const rendered = marked.parse(content);
    if (typeof rendered !== "string") {
      return "";
    }
    return this.enhanceMarkdownHtml(rendered, placeholders);
  }

  private replaceLinkMarkupWithPlaceholders(text: string) {
    const placeholders: LinkMarkup[] = [];
    LINK_MARKUP_PATTERN.lastIndex = 0;
    const content = text.replace(LINK_MARKUP_PATTERN, (match, inner) => {
      const markup = this.parseLinkMarkup(inner);
      if (!markup) {
        return match;
      }
      const index = placeholders.push(markup) - 1;
      return `<span data-link-placeholder="${index}"></span>`;
    });
    return { content, placeholders };
  }

  private enhanceMarkdownHtml(htmlContent: string, placeholders: LinkMarkup[]): string {
    if (typeof document === "undefined") {
      return htmlContent;
    }
    const template = document.createElement("template");
    template.innerHTML = htmlContent;
    template.content.querySelectorAll("script, style").forEach((el) => el.remove());

    placeholders.forEach((markup, index) => {
      template.content.querySelectorAll(`[data-link-placeholder="${index}"]`).forEach((node) => {
        node.replaceWith(this.createLinkChipElement(markup));
      });
    });

    this.decorateDateLinks(template.content);

    const wrapper = document.createElement("div");
    wrapper.appendChild(template.content);
    return wrapper.innerHTML;
  }

  private createLinkChipElement(markup: LinkMarkup): HTMLElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "link-chip";
    button.dataset.linkType = markup.type;
    button.dataset.linkValue = markup.value;
    button.dataset.linkLabel = markup.label;
    button.textContent = markup.label;
    return button;
  }

  private decorateDateLinks(target: DocumentFragment) {
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT);
    const nodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      const textNode = current as Text;
      const textContent = textNode.textContent ?? "";
      if (DATE_TEXT_PATTERN.test(textContent) && !this.shouldSkipDateLinkWrapping(textNode)) {
        nodes.push(textNode);
      }
      current = walker.nextNode();
    }
    nodes.forEach((node) => this.wrapDateMatches(node));
  }

  private shouldSkipDateLinkWrapping(node: Text): boolean {
    let parent = node.parentElement;
    while (parent) {
      const tag = parent.tagName.toLowerCase();
      if (tag === "code" || tag === "pre") {
        return true;
      }
      parent = parent.parentElement;
    }
    return false;
  }

  private wrapDateMatches(node: Text) {
    const text = node.textContent ?? "";
    if (!text) {
      return;
    }
    const regex = new RegExp(DATE_TEXT_PATTERN.source, "g");
    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    let match: RegExpExecArray | null = null;

    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) {
        fragment.append(text.slice(lastIndex, match.index));
      }
      fragment.append(this.createDateLinkElement(match[0]));
      lastIndex = regex.lastIndex;
    }

    if (lastIndex < text.length) {
      fragment.append(text.slice(lastIndex));
    }

    node.replaceWith(fragment);
  }

  private createDateLinkElement(value: string): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "date-link";
    button.dataset.date = value;
    button.textContent = value;
    return button;
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

  private renderDateLinkedTextNode(text: string | null | undefined) {
    const segments = this.renderDateLinkedTextSegments(text);
    return html`${segments}`;
  }

  private renderDateLinkedTextSegments(text: string | null | undefined) {
    const value = text ?? "";
    return renderTextWithDateLinks(value, (date) => this.emitDateLink(date));
  }

  private renderCommandChip(command: string, key?: string, pending?: boolean) {
    const expanded = key ? this.expandedCommandKeys.has(key) : false;
    const labelText = this.buildCommandChipLabel(command);
    const parsed = parseCanonicalCommand(command);
    const commandUid = parsed?.args.uid ?? null;
    const chipClasses = { "command-chip": true, "pending-command": Boolean(pending) };
    const button = html`<button
      type="button"
      class=${classMap(chipClasses)}
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
    
    // If the command has a what or hint, use it as the label
    const intentLabel = parsed.args.what ?? parsed.args.hint;
    if (intentLabel) {
      return this.clipCommandLabel(intentLabel);
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
    if (label.length <= 60) {
      return label;
    }
    return `${label.slice(0, 57).trimEnd()}…`;
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

  private handleChatLogClick(event: Event) {
    if (!this.chatLogEl) {
      return;
    }
    const target = this.normalizeEventTarget(event);
    if (!target || !this.chatLogEl.contains(target)) {
      return;
    }
    const linkChip = target.closest<HTMLElement>(".link-chip[data-link-type]");
    if (linkChip) {
      const markup = this.parseLinkDataset(linkChip);
      if (markup) {
        event.preventDefault();
        this.handleLinkMarkup(markup);
      }
      return;
    }
    const dateLink = target.closest<HTMLElement>(".date-link[data-date]");
    if (dateLink?.dataset.date) {
      event.preventDefault();
      this.emitDateLink(dateLink.dataset.date);
    }
  }

  private handleChatLogKeydown(event: KeyboardEvent) {
    if (event.key !== "Enter" && event.key !== " ") {
      return;
    }
    if (!this.chatLogEl) {
      return;
    }
    const target = this.normalizeEventTarget(event);
    if (!target || !this.chatLogEl.contains(target)) {
      return;
    }
    const linkChip = target.closest<HTMLElement>(".link-chip[data-link-type]");
    if (linkChip) {
      const markup = this.parseLinkDataset(linkChip);
      if (markup) {
        event.preventDefault();
        this.handleLinkMarkup(markup);
      }
      return;
    }
    const dateLink = target.closest<HTMLElement>(".date-link[data-date]");
    if (dateLink?.dataset.date) {
      event.preventDefault();
      this.emitDateLink(dateLink.dataset.date);
    }
  }

  private normalizeEventTarget(event: Event): HTMLElement | null {
    const path = event.composedPath();
    for (const node of path) {
      if (node instanceof HTMLElement) {
        return node;
      }
    }
    return null;
  }

  private parseLinkDataset(target: HTMLElement): LinkMarkup | null {
    const type = target.dataset.linkType;
    if (type !== "activity" && type !== "date") {
      return null;
    }
    const value = target.dataset.linkValue;
    const label = target.dataset.linkLabel ?? target.textContent ?? "";
    if (!value || !label) {
      return null;
    }
    return { type, value, label };
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
