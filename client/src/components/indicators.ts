/**
 * Shared indicator rendering for Plan and Day panels
 * 
 * Provides consistent icons, colors, and tooltips across all indicator displays.
 */

import { html, TemplateResult, css, CSSResult } from "lit";

// ============================================================================
// Types
// ============================================================================

export interface DayIndicatorData {
  flightCount: number;
  flightBooked: boolean;
  hasRentalCar: boolean;
  rentalCarBooked: boolean;
  lodgingStatus: "none" | "unbooked" | "booked" | "multiple";
  lodgingCity?: string;         // City name for lodging
  lodgingStartsHere?: boolean;  // Show bar above lodging icon
  lodgingEndsHere?: boolean;    // Show bar below lodging icon
  mealCount: number;
  mealsNeedingReservation: number;
  hasDateMismatchIssue: boolean;
  issueNoTransportToLodging: boolean;
  issueNoTransportToFlight: boolean;
}

export interface ActivityIndicatorData {
  activityType: string;
  isBooked: boolean;
  hasMismatch: boolean;
  reservationNeeded?: boolean;
  /** For flights and lodging: no transport activity scheduled before this activity's time */
  noTransportBefore?: boolean;
}

// ============================================================================
// Status Classes
// ============================================================================

type StatusClass = "status-green" | "status-yellow" | "status-red" | "status-purple" | "status-black" | "status-hidden";

// ============================================================================
// Day-level Indicator Rendering (header row in Plan/Day panels)
// ============================================================================

export function renderFlightIndicator(data: Pick<DayIndicatorData, "flightCount" | "flightBooked" | "issueNoTransportToFlight">): TemplateResult {
  if (data.flightCount === 0) {
    return html`<span class="indicator-slot status-hidden">${flightIcon()}</span>`;
  }
  
  // Build list of all issues/status
  const issues: string[] = [];
  issues.push(`${data.flightCount} flight(s)`);
  if (data.flightBooked) {
    issues.push("booked");
  } else {
    issues.push("not booked");
  }
  if (data.issueNoTransportToFlight) {
    issues.push("no transport");
  }
  
  // Purple if booked but has transport issue
  const hasTransportIssue = data.flightBooked && data.issueNoTransportToFlight;
  const statusClass: StatusClass = hasTransportIssue ? "status-purple" : (data.flightBooked ? "status-black" : "status-yellow");
  const title = issues.join("\n");
  
  return html`<span class="indicator-slot ${statusClass}" data-tooltip=${title}>
    ${flightIcon()}
  </span>`;
}

export function renderRentalCarIndicator(data: Pick<DayIndicatorData, "hasRentalCar" | "rentalCarBooked">): TemplateResult {
  if (!data.hasRentalCar) {
    return html`<span class="indicator-slot status-hidden">${carIcon()}</span>`;
  }
  const statusClass: StatusClass = data.rentalCarBooked ? "status-black" : "status-yellow";
  const title = data.rentalCarBooked ? "Rental car - booked" : "Rental car - not booked";
  return html`<span class="indicator-slot ${statusClass}" data-tooltip=${title}>
    ${carIcon()}
  </span>`;
}

export function renderLodgingIndicator(data: Pick<DayIndicatorData, "lodgingStatus" | "lodgingCity" | "issueNoTransportToLodging" | "lodgingStartsHere" | "lodgingEndsHere">): TemplateResult {
  const hasLodging = data.lodgingStatus !== "none";
  const showTopBar = data.lodgingStartsHere && hasLodging;
  const showBottomBar = data.lodgingEndsHere && hasLodging;
  
  // Build class for left/right bars to clip at start/end
  const leftBarClass = `lodging-bar-left${showTopBar ? " clip-top" : ""}${showBottomBar ? " clip-bottom" : ""}`;
  const rightBarClass = `lodging-bar-right${showTopBar ? " clip-top" : ""}${showBottomBar ? " clip-bottom" : ""}`;
  
  // Header line: "Lodging - city" or just "Lodging"
  const header = data.lodgingCity ? `Lodging - ${data.lodgingCity}` : "Lodging";
  
  if (data.lodgingStatus === "none") {
    return html`<span class="indicator-slot status-red" data-tooltip="No lodging">
      ${lodgingIcon()}
    </span>`;
  }
  if (data.lodgingStatus === "multiple") {
    const multiHeader = data.lodgingCity ? `Lodging - ${data.lodgingCity}` : "Lodging";
    return html`<span class="indicator-slot status-purple" data-tooltip="${multiHeader}\n- multiple options">
      ${showTopBar ? html`<span class="lodging-bar-top"></span>` : ""}
      <span class="${leftBarClass}"></span>
      ${lodgingIcon()}
      <span class="${rightBarClass}"></span>
      ${showBottomBar ? html`<span class="lodging-bar-bottom"></span>` : ""}
    </span>`;
  }
  
  // Build list of issues for booked or unbooked
  const issues: string[] = [];
  if (data.lodgingStatus === "booked") {
    issues.push("- booked");
  } else {
    issues.push("- not booked");
  }
  if (data.issueNoTransportToLodging) {
    issues.push("- no transport");
  }
  
  const title = header + "\n" + issues.join("\n");
  
  if (data.lodgingStatus === "booked") {
    // Purple if booked but has transport issue, green otherwise
    const statusClass: StatusClass = data.issueNoTransportToLodging ? "status-purple" : "status-green";
    return html`<span class="indicator-slot ${statusClass}" data-tooltip=${title}>
      ${showTopBar ? html`<span class="lodging-bar-top"></span>` : ""}
      <span class="${leftBarClass}"></span>
      ${lodgingIcon()}
      <span class="${rightBarClass}"></span>
      ${showBottomBar ? html`<span class="lodging-bar-bottom"></span>` : ""}
    </span>`;
  }
  
  // unbooked
  return html`<span class="indicator-slot status-yellow" data-tooltip=${title}>
    ${showTopBar ? html`<span class="lodging-bar-top"></span>` : ""}
    <span class="${leftBarClass}"></span>
    ${lodgingIcon()}
    <span class="${rightBarClass}"></span>
    ${showBottomBar ? html`<span class="lodging-bar-bottom"></span>` : ""}
  </span>`;
}

export function renderMealIndicator(data: Pick<DayIndicatorData, "mealCount" | "mealsNeedingReservation">): TemplateResult {
  if (data.mealCount === 0) {
    return html`<span class="indicator-slot status-hidden">${mealIcon()}</span>`;
  }
  const statusClass: StatusClass = data.mealsNeedingReservation > 0 ? "status-yellow" : "status-black";
  const title = data.mealsNeedingReservation > 0 
    ? `${data.mealCount} meal(s) - ${data.mealsNeedingReservation} need reservation` 
    : `${data.mealCount} meal(s)`;
  return html`<span class="indicator-slot ${statusClass}" data-tooltip=${title}>
    ${mealIcon()}
  </span>`;
}

export function renderIssueIndicator(data: Pick<DayIndicatorData, "hasDateMismatchIssue">): TemplateResult {
  if (!data.hasDateMismatchIssue) {
    return html`<span class="indicator-slot status-hidden">${issueIcon()}</span>`;
  }
  return html`<span class="indicator-slot status-red" data-tooltip="Booking date mismatch - activity moved after booking">
    ${issueIcon()}
  </span>`;
}

/** Render all 5 indicator slots for a day header */
export function renderDayIndicatorSlots(data: DayIndicatorData): TemplateResult {
  return html`
    ${renderFlightIndicator(data)}
    ${renderRentalCarIndicator(data)}
    ${renderLodgingIndicator(data)}
    ${renderMealIndicator(data)}
    ${renderIssueIndicator(data)}
  `;
}

// ============================================================================
// Activity-level Indicator Rendering (per-activity row in Day panel)
// ============================================================================

export function renderActivityFlightSlot(data: ActivityIndicatorData): TemplateResult {
  if (data.activityType !== "flight") {
    return html`<span class="indicator-slot status-hidden">${flightIcon()}</span>`;
  }
  
  // Build tooltip with all issues
  const issues: string[] = [];
  issues.push(data.isBooked ? "Flight - booked" : "Flight - not booked");
  if (data.noTransportBefore) {
    issues.push("no transport scheduled");
  }
  if (data.hasMismatch) {
    issues.push("booking date mismatch");
  }
  
  // Purple if booked but has transport issue, otherwise black/yellow based on booking
  const hasTransportIssue = data.isBooked && data.noTransportBefore;
  const statusClass: StatusClass = hasTransportIssue ? "status-purple" : (data.isBooked ? "status-black" : "status-yellow");
  const title = issues.join("\n");
  
  return html`<span class="indicator-slot ${statusClass}" data-tooltip=${title}>
    ${flightIcon()}
  </span>`;
}

export function renderActivityRentalCarSlot(data: ActivityIndicatorData): TemplateResult {
  if (data.activityType !== "rentalCar") {
    return html`<span class="indicator-slot status-hidden">${carIcon()}</span>`;
  }
  
  // Build tooltip with all issues
  const issues: string[] = [];
  issues.push(data.isBooked ? "Rental car - booked" : "Rental car - not booked");
  if (data.hasMismatch) {
    issues.push("booking date mismatch");
  }
  
  const statusClass: StatusClass = data.isBooked ? "status-black" : "status-yellow";
  const title = issues.join("\n");
  
  return html`<span class="indicator-slot ${statusClass}" data-tooltip=${title}>
    ${carIcon()}
  </span>`;
}

export function renderActivityLodgingSlot(data: ActivityIndicatorData): TemplateResult {
  if (data.activityType !== "lodging") {
    return html`<span class="indicator-slot status-hidden">${lodgingIcon()}</span>`;
  }
  
  // Build tooltip with all issues
  const issues: string[] = [];
  issues.push(data.isBooked ? "Lodging - booked" : "Lodging - not booked");
  if (data.noTransportBefore) {
    issues.push("no transport scheduled");
  }
  if (data.hasMismatch) {
    issues.push("booking date mismatch");
  }
  
  // Purple if booked but has transport issue, otherwise green/yellow based on booking
  const hasTransportIssue = data.isBooked && data.noTransportBefore;
  const statusClass: StatusClass = hasTransportIssue ? "status-purple" : (data.isBooked ? "status-green" : "status-yellow");
  const title = issues.join("\n");
  
  return html`<span class="indicator-slot ${statusClass}" data-tooltip=${title}>
    ${lodgingIcon()}
  </span>`;
}

export function renderActivityMealSlot(data: ActivityIndicatorData): TemplateResult {
  if (data.activityType !== "meal") {
    return html`<span class="indicator-slot status-hidden">${mealIcon()}</span>`;
  }
  
  // Build tooltip with all issues
  const issues: string[] = [];
  const needsRes = data.reservationNeeded === true;
  if (needsRes && !data.isBooked) {
    issues.push("Meal - needs reservation");
  } else {
    issues.push("Meal");
  }
  if (data.hasMismatch) {
    issues.push("booking date mismatch");
  }
  
  // Yellow if needs reservation and not booked, black otherwise
  const statusClass: StatusClass = (needsRes && !data.isBooked) ? "status-yellow" : "status-black";
  const title = issues.join("\n");
  
  return html`<span class="indicator-slot ${statusClass}" data-tooltip=${title}>
    ${mealIcon()}
  </span>`;
}

export function renderActivityIssueSlot(data: Pick<ActivityIndicatorData, "hasMismatch">): TemplateResult {
  if (!data.hasMismatch) {
    return html`<span class="indicator-slot status-hidden">${issueIcon()}</span>`;
  }
  return html`<span class="indicator-slot status-red" data-tooltip="Booking date mismatch - activity moved after booking">
    ${issueIcon()}
  </span>`;
}

/** Render all 5 indicator slots for an activity row */
export function renderActivityIndicatorSlots(data: ActivityIndicatorData): TemplateResult {
  return html`
    ${renderActivityFlightSlot(data)}
    ${renderActivityRentalCarSlot(data)}
    ${renderActivityLodgingSlot(data)}
    ${renderActivityMealSlot(data)}
    ${renderActivityIssueSlot(data)}
  `;
}

// ============================================================================
// Shared CSS for indicator slots (to be included in component styles)
// ============================================================================

export const indicatorSlotStyles: CSSResult = css`
  .indicator-slots {
    display: flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    flex-shrink: 0;
  }

  .indicator-slot {
    width: 16px;
    height: 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    position: relative;
  }

  /* Custom instant tooltip for indicator slots */
  .indicator-slot[data-tooltip] {
    cursor: help;
  }

  .indicator-slot[data-tooltip]:hover::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    background: white;
    color: #333;
    padding: 6px 10px;
    border-radius: 4px;
    border: 1px solid #ccc;
    box-shadow: 0 2px 4px rgba(0,0,0,0.1);
    font-size: 11px;
    font-weight: 400;
    font-family: system-ui, sans-serif;
    white-space: pre;
    z-index: 1000;
    pointer-events: none;
    margin-bottom: 4px;
  }

  .indicator-slot svg {
    width: 14px;
    height: 14px;
  }

  /* Lodging transition bars */
  .lodging-bar-top,
  .lodging-bar-bottom {
    position: absolute;
    left: 1px;
    right: 1px;
    height: 2px;
    background: currentColor;
  }

  .lodging-bar-top {
    top: -1px;
  }

  .lodging-bar-bottom {
    bottom: -1px;
  }

  .lodging-bar-left,
  .lodging-bar-right {
    position: absolute;
    /* Extend beyond the slot to connect with adjacent rows */
    top: -10px;
    bottom: -10px;
    width: 2px;
    background: currentColor;
  }

  .lodging-bar-left {
    left: -1px;
  }

  .lodging-bar-right {
    right: -1px;
  }

  /* Clip side bars at top/bottom when lodging starts/ends */
  .lodging-bar-left.clip-top,
  .lodging-bar-right.clip-top {
    top: -1px;
  }

  .lodging-bar-left.clip-bottom,
  .lodging-bar-right.clip-bottom {
    bottom: -1px;
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
`;

// ============================================================================
// Lucide-style SVG Icons
// ============================================================================

export function flightIcon(): TemplateResult {
  return html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>
  </svg>`;
}

export function carIcon(): TemplateResult {
  return html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 17h2c.6 0 1-.4 1-1v-3c0-.9-.7-1.7-1.5-1.9C18.7 10.6 16 10 16 10s-1.3-1.4-2.2-2.3c-.5-.4-1.1-.7-1.8-.7H5c-.6 0-1.1.4-1.4.9l-1.4 2.9A3.7 3.7 0 0 0 2 12v4c0 .6.4 1 1 1h2"/>
    <circle cx="7" cy="17" r="2"/>
    <path d="M9 17h6"/>
    <circle cx="17" cy="17" r="2"/>
  </svg>`;
}

export function lodgingIcon(): TemplateResult {
  return html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 22v-6.57"/>
    <path d="M12 11h.01"/>
    <path d="M12 7h.01"/>
    <path d="M14 15.43V22"/>
    <path d="M15 16a5 5 0 0 0-6 0"/>
    <path d="M16 11h.01"/>
    <path d="M16 7h.01"/>
    <path d="M8 11h.01"/>
    <path d="M8 7h.01"/>
    <rect x="4" y="2" width="16" height="20" rx="2"/>
  </svg>`;
}

export function mealIcon(): TemplateResult {
  return html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/>
    <path d="M7 2v20"/>
    <path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>
  </svg>`;
}

export function issueIcon(): TemplateResult {
  return html`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/>
    <path d="M12 9v4"/>
    <path d="M12 17h.01"/>
  </svg>`;
}
