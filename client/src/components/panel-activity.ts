import { LitElement, css, html, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { Activity, CountryInfo } from "../types";
import { describeActivity } from "../view/view-plan";
import { dateLinkStyles, renderTextWithDateLinks } from "../date-link";
import { formatMonthDayLabel } from "../datetime";

@customElement("panel-activity")
export class PanelActivity extends LitElement {
  @property({ attribute: false }) activity: Activity | null = null;
  @property({ type: Boolean }) canCreate = false;
  @property({ attribute: false }) countries: CountryInfo[] = [];
  @property({ type: Boolean }) marked = false;

  static styles = [css`
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

    .title.marked {
      background: #e8f8e5;
      border-radius: 4px;
      padding: 0.1rem 0.35rem;
    }

    .reservation-warning {
      color: #b91c1c;
      font-weight: 600;
      font-size: 0.9rem;
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

    .price-value {
      font-weight: 600;
      color: #0f172a;
      cursor: default;
    }

    .price-value.price-warning {
      color: #b91c1c;
    }

    .price-value.price-tooltip {
      position: relative;
      cursor: pointer;
    }

    .price-value.price-tooltip::after {
      content: attr(data-tooltip);
      position: absolute;
      left: 0;
      bottom: calc(100% + 0.35rem);
      background: #0f172a;
      color: #f8fafc;
      padding: 0.35rem 0.45rem;
      border-radius: 4px;
      white-space: pre-line;
      font-size: 0.75rem;
      line-height: 1.2;
      box-shadow: 0 4px 10px rgba(15, 23, 42, 0.25);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.05s ease;
      z-index: 5;
      min-width: 220px;
      max-width: 320px;
    }

    .price-value.price-tooltip::before {
      content: "";
      position: absolute;
      left: 12px;
      bottom: calc(100% + 0.05rem);
      border-width: 6px;
      border-style: solid;
      border-color: #0f172a transparent transparent transparent;
      opacity: 0;
      transition: opacity 0.05s ease;
      z-index: 5;
    }

    .price-value.price-tooltip:hover::after,
    .price-value.price-tooltip:hover::before {
      opacity: 1;
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

    .extra-value-warning {
      color: #b91c1c;
      font-weight: 600;
    }

    .uid-footer {
      font-size: 0.65rem;
      color: #94a3b8;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      margin-top: auto;
    }
  `, dateLinkStyles];

  render() {
    if (!this.activity) {
      return html`<div class="empty">Hover an activity in the Day panel to see its details.</div>`;
    }

    const activity = this.activity;
    const title = describeActivity(activity);
    const dateLine = buildDateLine(activity);
    const { priceValue, priceIsValid, statusText, priceTooltip } = buildPriceAndStatus(
      activity,
      this.countries ?? []
    );
    const description = extractDescription(activity);
    const extras = buildExtraFields(activity);
    const showReservationWarning = shouldShowReservationWarning(activity);
    const priceClass = priceIsValid ? "price-value" : "price-value price-warning";

    return html`
      <div class="card">
        <div class="header">
          <h3 class=${this.marked ? "title marked" : "title"}>${title}</h3>
          <button
            class="create-button"
            aria-label="Add activity"
            ?disabled=${!this.canCreate}
            @click=${this.handleCreate}
          >
            +
          </button>
        </div>
        ${showReservationWarning ? html`<div class="reservation-warning">Reservations are needed.</div>` : null}
        ${dateLine ? html`<div class="line">${this.renderDateLinkedText(dateLine)}</div>` : null}
        ${(priceValue || statusText)
          ? html`<div class="line price-status">
              <span>
                Price:
                <span
                  class=${priceTooltip ? `${priceClass} price-tooltip` : priceClass}
                  data-tooltip=${priceTooltip ?? nothing}
                >
                  ${priceValue ?? "—"}
                </span>
              </span>
              <span>Status: ${statusText ?? "—"}</span>
            </div>`
          : null}
        ${description ? html`<div class="line">${this.renderDateLinkedText(description)}</div>` : null}
        ${extras.length
          ? html`<ul class="extra-list">
              ${extras.map(
                (entry) => {
                  const isNotes = entry.key.trim().toLowerCase() === "notes";
                  const valueClass = entry.isWarning ? "extra-value-warning" : "";
                  return html`<li class="extra-item">
                  <span class="extra-key">${entry.key}:</span>
                  <span class=${valueClass}>${isNotes ? this.renderDateLinkedText(entry.value) : entry.value}</span>
                </li>`;
                }
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

  private renderDateLinkedText(text: string | null | undefined) {
    const value = text ?? "";
    return renderTextWithDateLinks(value, (date) => this.emitDateLink(date));
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

  const duration = formatDuration(activity);
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
  const arriveDate = getStringField(record, "arriveDate");
  const departDate = activity.date ?? "";
  const stops = getStops(record);

  const departLabel = buildAirportTimeLabel(departAirport, departTime);
  
  // Check if arrival is on a different date
  const arriveOnDifferentDay = arriveDate && arriveDate !== departDate;
  const arriveDateLabel = arriveOnDifferentDay ? formatMonthDayLabel(arriveDate) : null;
  const arriveLabel = buildAirportTimeDateLabel(arriveAirport, arriveDateLabel, arriveTime);
  
  if (!departLabel && !arriveLabel) {
    return null;
  }

  const stopsLabel = stops !== null ? ` (${stops} stop${stops === 1 ? "" : "s"})` : "";
  if (departLabel && arriveLabel) {
    return `${departLabel} => ${arriveLabel}${stopsLabel}`.trim();
  }
  return `${departLabel || arriveLabel}${stopsLabel}`.trim();
}

function buildAirportTimeDateLabel(airport: string | null, dateLabel: string | null, time: string | null): string {
  const parts: string[] = [];
  if (airport) {
    parts.push(airport);
  }
  if (dateLabel) {
    parts.push(dateLabel);
  }
  if (time) {
    parts.push(time);
  }
  return parts.join(" ").trim();
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
  return formatMonthDayLabel(value, { month: "short", day: "numeric" });
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

function formatDuration(activity: Activity): string | null {
  const normalized = normalizeDurationText(activity.duration);
  if (normalized) {
    return normalized;
  }
  if (typeof activity.durationMinutes === "number" && Number.isFinite(activity.durationMinutes) && activity.durationMinutes > 0) {
    return convertMinutesToDurationText(activity.durationMinutes);
  }
  return null;
}

const DURATION_TEXT_PATTERN = /^(\d+(?:\.\d+)?)\s*(days?|day|hours?|hour|hrs?|minutes?|minute|mins?|min)$/i;

function normalizeDurationText(value?: string | null): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = trimmed.match(DURATION_TEXT_PATTERN);
  if (!match) {
    return trimmed;
  }
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) {
    return null;
  }
  const unit = normalizeDurationUnit(match[2]);
  return `${formatDurationAmount(amount)} ${pluralizeDurationUnit(unit, amount)}`;
}

function normalizeDurationUnit(unit: string): "day" | "hour" | "min" {
  const normalized = unit.toLowerCase();
  if (normalized.startsWith("day")) {
    return "day";
  }
  if (normalized.startsWith("hour") || normalized.startsWith("hr")) {
    return "hour";
  }
  return "min";
}

function formatDurationAmount(amount: number): string {
  if (Number.isInteger(amount)) {
    return amount.toString();
  }
  return Number(amount.toFixed(1)).toString();
}

function pluralizeDurationUnit(unit: "day" | "hour" | "min", amount: number): string {
  const isSingular = Math.abs(amount - 1) < 1e-9;
  switch (unit) {
    case "day":
      return isSingular ? "day" : "days";
    case "hour":
      return isSingular ? "hour" : "hours";
    default:
      return isSingular ? "min" : "mins";
  }
}

function convertMinutesToDurationText(minutes: number): string {
  if (minutes % 1440 === 0) {
    const days = minutes / 1440;
    return `${days} ${pluralizeDurationUnit("day", days)}`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${pluralizeDurationUnit("hour", hours)}`;
  }
  if (minutes >= 60) {
    const hours = Number((minutes / 60).toFixed(1));
    return `${formatDurationAmount(hours)} ${pluralizeDurationUnit("hour", hours)}`;
  }
  return `${minutes} ${pluralizeDurationUnit("min", minutes)}`;
}

const CURRENCY_AND_PRICE_PATTERN = /^([A-Z]{3})\s(\d+(?:\.\d{1,2})?)$/;

function buildPriceAndStatus(activity: Activity, countries: CountryInfo[]): {
  priceValue: string | null;
  priceIsValid: boolean;
  statusText: string | null;
  priceTooltip: string | null;
} {
  const raw = typeof activity.currencyAndPrice === "string" ? activity.currencyAndPrice.trim() : "";
  const statusText = activity.status ? capitalize(activity.status) : null;
  if (!raw) {
    return { priceValue: null, priceIsValid: true, statusText, priceTooltip: null };
  }

  const match = raw.match(CURRENCY_AND_PRICE_PATTERN);
  if (!match) {
    return {
      priceValue: null,
      priceIsValid: false,
      statusText,
      priceTooltip: "Use format \"CUR amount\" (decimals optional) to enable USD conversion."
    };
  }

  const currencyCode = match[1];
  const originalAmountText = match[2];
  const amount = Number(originalAmountText);
  if (!Number.isFinite(amount) || amount < 0) {
    return {
      priceValue: null,
      priceIsValid: false,
      statusText,
      priceTooltip: "Price amount must be a positive number."
    };
  }

  const rateRecord = findExchangeRateForCurrency(countries, currencyCode);
  if (!rateRecord) {
    return {
      priceValue: null,
      priceIsValid: false,
      statusText,
      priceTooltip: `Add a country with ${currencyCode} exchangeRateToUSD to convert prices.`
    };
  }

  const convertedAmount = amount * rateRecord.exchangeRateToUSD;
  if (!Number.isFinite(convertedAmount)) {
    return {
      priceValue: null,
      priceIsValid: false,
      statusText,
      priceTooltip: "Exchange rate must be numeric to convert prices."
    };
  }

  const roundedUsd = Math.round(convertedAmount);
  const preciseUsd = convertedAmount.toFixed(2);
  const usdDisplay = formatRoundedUsd(roundedUsd);
  const tooltip = `${formatOriginalAmount(originalAmountText)} ${currencyCode} x ${formatExchangeRate(
    rateRecord.exchangeRateToUSD
  )} = ${preciseUsd} USD`;

  return {
    priceValue: usdDisplay,
    priceIsValid: true,
    statusText,
    priceTooltip: tooltip
  };
}

function formatOriginalAmount(amountText: string): string {
  return amountText;
}

function formatRoundedUsd(amount: number): string {
  if (!Number.isFinite(amount)) {
    return "USD ?";
  }
  const formatted = amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  return `USD ${formatted}`;
}

function findExchangeRateForCurrency(countries: CountryInfo[], currencyAlpha3: string): CountryInfo | null {
  const target = currencyAlpha3.trim().toUpperCase();
  if (!target) {
    return null;
  }
  return (
    countries.find((country) => country.currencyAlpha3?.trim().toUpperCase() === target && country.exchangeRateToUSD > 0) ??
    null
  );
}

function formatExchangeRate(value: number): string {
  if (!Number.isFinite(value)) {
    return "?";
  }
  return value >= 1 ? value.toFixed(2) : value.toFixed(6);
}

function shouldShowReservationWarning(activity: Activity): boolean {
  const status = activity.status?.trim().toLowerCase();
  if (status !== "idea" && status !== "planned") {
    return false;
  }
  const record = activity as Activity & Record<string, unknown>;
  const rawNeeded = record.reservationNeeded;
  if (typeof rawNeeded === "boolean") {
    return rawNeeded;
  }
  if (typeof rawNeeded === "string") {
    const normalized = rawNeeded.trim().toLowerCase();
    return normalized === "true" || normalized === "yes" || normalized === "1";
  }
  if (typeof rawNeeded === "number") {
    return rawNeeded !== 0;
  }
  return false;
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
    "duration",
    "price",
    "currency",
    "status",
    "description",
    "activityType",
    "name",
    "currencyAndPrice",
    "lineNum",
    "bookingDate"
  ]);

  if (activity.activityType?.trim().toLowerCase() === "flight") {
    ["airport", "arriveAirport", "arriveDate", "arriveTime", "stops"].forEach((key) => omit.add(key));
  }

  const entries = Object.entries(activity) as Array<[string, unknown]>;
  const extras = entries
    .filter(([key, value]) => {
      if (omit.has(key)) return false;
      if (value === undefined || value === null || value === "") return false;
      // Don't show reservationNeeded if it's false
      if (key === "reservationNeeded" && value === false) return false;
      return true;
    })
    .map(([key, value]) => ({ key: formatKeyLabel(key), value: formatExtraValue(value), isWarning: false }));

  // Handle bookingDate specially: show in warning red if it doesn't match the activity date
  const bookingDate = (activity as unknown as Record<string, unknown>).bookingDate;
  if (typeof bookingDate === "string" && bookingDate.trim() !== "") {
    const activityDate = activity.date?.trim() ?? "";
    if (bookingDate.trim() !== activityDate) {
      extras.push({
        key: formatKeyLabel("bookingDate"),
        value: bookingDate.trim(),
        isWarning: true
      });
    }
  }

  return extras;
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
