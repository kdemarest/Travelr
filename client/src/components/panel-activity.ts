import { LitElement, css, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Activity } from "../types";
import { describeActivity } from "../view/view-plan";

@customElement("panel-activity")
export class PanelActivity extends LitElement {
  @property({ attribute: false }) activity: Activity | null = null;
  @property({ type: Boolean }) canCreate = false;

  static styles = css`
    :host {
      display: block;
      color: #0f172a;
      font-family: inherit;
    }

    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      min-height: 160px;
    }

    .header {
      display: flex;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .empty {
      color: #94a3b8;
      font-style: italic;
    }

    .title {
      margin: 0;
      font-size: 1.1rem;
      font-weight: 600;
      color: #0f172a;
      flex: 1;
    }

    .create-button {
      border: 1px solid #cbd5f5;
      background: #ffffff;
      color: #312e81;
      border-radius: 999px;
      width: 32px;
      height: 32px;
      font-size: 1rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    }

    .create-button:hover {
      background: #e0e7ff;
      border-color: #818cf8;
    }

    .create-button:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      background: #e2e8f0;
      color: #94a3b8;
    }

    .line {
      font-size: 0.95rem;
      color: #475569;
    }

    .price-status {
      display: flex;
      gap: 1.5rem;
      flex-wrap: wrap;
    }

    .extra-list {
      list-style: none;
      padding: 0;
      margin: 0.25rem 0 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }

    .extra-item {
      font-size: 0.9rem;
      color: #475569;
    }

    .extra-key {
      font-weight: 600;
      margin-right: 0.35rem;
    }

    .uid-footer {
      font-size: 0.65rem;
      color: #94a3b8;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-top: auto;
    }
  `;

  render() {
    if (!this.activity) {
      return html`<div class="empty">Hover an activity in the Day panel to see its details.</div>`;
    }

    const activity = this.activity;
    const title = describeActivity(activity);
    const dateLine = buildDateLine(activity);
    const { priceText, statusText } = buildPriceAndStatus(activity);
    const description = extractDescription(activity);
    const extras = buildExtraFields(activity);

    return html`
      <div class="card">
        <div class="header">
          <h3 class="title">${title}</h3>
          <button
            class="create-button"
            aria-label="Add activity"
            ?disabled=${!this.canCreate}
            @click=${this.handleCreate}
          >
            +
          </button>
        </div>
        ${dateLine ? html`<div class="line">${dateLine}</div>` : null}
        ${(priceText || statusText)
          ? html`<div class="line price-status">
              <span>Price: ${priceText ?? "—"}</span>
              <span>Status: ${statusText ?? "—"}</span>
            </div>`
          : null}
        ${description ? html`<div class="line">${description}</div>` : null}
        ${extras.length
          ? html`<ul class="extra-list">
              ${extras.map(
                (entry) => html`<li class="extra-item">
                  <span class="extra-key">${entry.key}:</span>
                  <span>${entry.value}</span>
                </li>`
              )}
            </ul>`
          : null}
        ${activity.uid ? html`<div class="uid-footer">${activity.uid}</div>` : null}
      </div>
    `;
  }

  private handleCreate(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    if (!this.canCreate) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("panel-activity-create", {
        bubbles: true,
        composed: true
      })
    );
  }
}

function buildDateLine(activity: Activity): string | null {
  const formattedDate = formatDate(activity.date);
  const customSchedule = formatActivitySchedule(activity);
  if (customSchedule) {
    return formattedDate ? `${formattedDate} · ${customSchedule}` : customSchedule;
  }

  const parts: string[] = [];
  if (formattedDate) {
    parts.push(formattedDate);
  }

  const formattedTime = formatTime(activity.time);
  if (formattedTime) {
    parts.push(`at ${formattedTime}`);
  }

  const duration = formatDuration(activity.durationMinutes);
  if (duration) {
    parts.push(`for ${duration}`);
  }

  return parts.length ? parts.join(" ") : null;
}

function formatActivitySchedule(activity: Activity): string | null {
  const type = activity.activityType?.trim().toLowerCase();
  if (!type) {
    return null;
  }
  const formatter = activityScheduleFormatters[type];
  return formatter ? formatter(activity) : null;
}

type ActivityScheduleFormatter = (activity: Activity) => string | null;

const activityScheduleFormatters: Record<string, ActivityScheduleFormatter> = {
  flight: formatFlightSchedule
};

function formatFlightSchedule(activity: Activity): string | null {
  const record = activity as Activity & Record<string, unknown>;
  const departAirport = getStringField(record, "airport");
  const departTime = normalizeActivityTime(activity.time) ?? "";
  const arriveAirport = getStringField(record, "arriveAirport");
  const arriveTime = getStringField(record, "arriveTime") ?? "";
  const stops = getStops(record);

  const departLabel = buildAirportTimeLabel(departAirport, departTime);
  const arriveLabel = buildAirportTimeLabel(arriveAirport, arriveTime);
  if (!departLabel && !arriveLabel) {
    return null;
  }

  const stopsLabel = stops !== null ? ` (${stops} stop${stops === 1 ? "" : "s"})` : "";
  if (departLabel && arriveLabel) {
    return `${departLabel} => ${arriveLabel}${stopsLabel}`.trim();
  }
  return `${departLabel || arriveLabel}${stopsLabel}`.trim();
}

function buildAirportTimeLabel(airport: string | null, time: string | null): string {
  const parts: string[] = [];
  if (airport) {
    parts.push(airport);
  }
  if (time) {
    parts.push(time);
  }
  return parts.join(" ").trim();
}

function getStringField(source: Record<string, unknown>, key: string): string | null {
  const value = source[key];
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length ? trimmed : null;
  }
  return null;
}

function normalizeActivityTime(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length ? trimmed : null;
}

function getStops(source: Record<string, unknown>): number | null {
  const value = source.stops;
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, Math.trunc(value));
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.max(0, Math.trunc(parsed));
    }
  }
  return null;
}

function formatDate(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTime(value?: string | null): string | null {
  if (value === undefined || value === null) {
    return "--:--";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "--:--";
  }
  const match = trimmed.match(/^([0-1]?\d|2[0-3]):?(\d{2})?$/);
  if (!match) {
    return trimmed;
  }
  const hours = match[1].padStart(2, "0");
  const minutes = (match[2] ?? "00").padStart(2, "0");
  return `${hours}:${minutes}`;
}

function formatDuration(minutes?: number | null): string | null {
  if (minutes === undefined || minutes === null) {
    return null;
  }
  const hours = minutes / 60;
  const formatted = Number.isInteger(hours) ? hours.toString() : hours.toFixed(1);
  const unit = Number(formatted) === 1 ? "hour" : "hours";
  return `${formatted} ${unit}`;
}

function buildPriceAndStatus(activity: Activity): { priceText: string | null; statusText: string | null } {
  const priceText = formatPrice(activity.price, activity.currency);
  const statusText = activity.status ? capitalize(activity.status) : null;
  return { priceText, statusText };
}

function formatPrice(price?: number | string | null, currency?: string | null): string | null {
  if (price === undefined || price === null || price === "") {
    return null;
  }
  const numeric = typeof price === "number" ? price : Number(price);
  if (Number.isNaN(numeric)) {
    return String(price);
  }
  if (currency) {
    try {
      return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(numeric);
    } catch {
      // fall back if currency code invalid
    }
  }
  return numeric.toFixed(2);
}

function capitalize(value: string): string {
  if (!value) {
    return value;
  }
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function extractDescription(activity: Activity): string | null {
  const raw = activity.description?.trim();
  return raw && raw.length > 0 ? raw : null;
}

function buildExtraFields(activity: Activity) {
  const omit = new Set([
    "uid",
    "date",
    "time",
    "durationMinutes",
    "price",
    "currency",
    "status",
    "description",
    "activityType",
    "name"
  ]);

  if (activity.activityType?.trim().toLowerCase() === "flight") {
    ["airport", "arriveAirport", "arriveDate", "arriveTime", "stops"].forEach((key) => omit.add(key));
  }
  const entries = Object.entries(activity) as Array<[string, unknown]>;
  return entries
    .filter(([key, value]) => !omit.has(key) && value !== undefined && value !== null && value !== "")
    .map(([key, value]) => ({ key: formatKeyLabel(key), value: formatExtraValue(value) }));
}

function formatKeyLabel(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/^./, (char) => char.toUpperCase());
}

function formatExtraValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return value.toString();
  }
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }
  return JSON.stringify(value);
}

declare global {
  interface HTMLElementTagNameMap {
    "panel-activity": PanelActivity;
  }
}
