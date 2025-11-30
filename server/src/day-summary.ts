/**
 * Day Summary - Per-day derived metrics for trip planning
 * 
 * Computed from activities to give LLM and UI quick insights into each day's state.
 */

import { TripModel, DaySummary } from "./types.js";

export type { DaySummary } from "./types.js";

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Activities that can span multiple days */
type SpanningActivity = {
  activity: Record<string, unknown>;
  startDate: string;
  endDate: string;  // inclusive last day
  type: 'lodging' | 'flight' | 'rentalCar';
};

/**
 * Compute day summaries for all days in the trip date range
 */
export function computeDaySummaries(model: TripModel): DaySummary[] {
  const activities = model.activities || [];
  
  // Find date range from activity start dates
  const activityDates = activities
    .map(a => a.date as string | undefined)
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d))
    .sort();
  
  if (activityDates.length === 0) {
    return [];
  }
  
  // Build spanning activities first to determine full date range
  const spanningActivities = buildSpanningActivities(activities);
  
  // Collect all span end dates
  const spanEndDates = spanningActivities
    .map(s => s.endDate)
    .filter((d): d is string => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d));
  
  // Start date is earliest activity date
  const startDate = activityDates[0];
  
  // End date is latest of: activity dates OR span end dates
  const allEndCandidates = [...activityDates, ...spanEndDates].sort();
  const endDate = allEndCandidates[allEndCandidates.length - 1];
  
  // Generate all dates in range
  const allDates = generateDateRange(startDate, endDate);
  
  // Group activities by date
  const activitiesByDate = new Map<string, typeof activities>();
  for (const activity of activities) {
    const date = activity.date as string | undefined;
    if (!date) continue;
    if (!activitiesByDate.has(date)) {
      activitiesByDate.set(date, []);
    }
    activitiesByDate.get(date)!.push(activity);
  }
  
  // Build summaries
  const summaries: DaySummary[] = [];
  
  for (const date of allDates) {
    const dayActivities = activitiesByDate.get(date) || [];
    
    // Find spanning activities that cover this date
    const activeSpans = spanningActivities.filter(span => 
      date >= span.startDate && date <= span.endDate
    );
    
    const summary = computeDaySummary(date, dayActivities, activeSpans);
    summaries.push(summary);
  }
  
  return summaries;
}

function generateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  const current = new Date(start + 'T00:00:00');
  const endDate = new Date(end + 'T00:00:00');
  
  while (current <= endDate) {
    dates.push(current.toISOString().slice(0, 10));
    current.setDate(current.getDate() + 1);
  }
  
  return dates;
}

/**
 * Parse duration text like "6 days" or "3 hours" into number of days (can be fractional)
 */
function parseDurationToDays(duration?: string | null, durationMinutes?: number | null): number {
  // Try durationMinutes first
  if (typeof durationMinutes === 'number' && durationMinutes > 0) {
    return durationMinutes / 1440; // 1440 minutes per day
  }
  
  // Try parsing duration text
  if (typeof duration !== 'string' || !duration.trim()) {
    return 0;
  }
  
  const match = duration.trim().match(/^(\d+(?:\.\d+)?)\s*(days?|hours?|hrs?|minutes?|mins?|min)$/i);
  if (!match) {
    return 0;
  }
  
  const amount = parseFloat(match[1]);
  const unit = match[2].toLowerCase();
  
  if (unit.startsWith('day')) {
    return amount;
  } else if (unit.startsWith('hour') || unit.startsWith('hr')) {
    return amount / 24;
  } else {
    return amount / 1440;
  }
}

/**
 * Add days to a date string, returning a new date string
 */
function addDaysToDate(dateStr: string, days: number): string {
  const date = new Date(dateStr + 'T00:00:00');
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Build list of activities that span multiple days
 */
function buildSpanningActivities(activities: Array<Record<string, unknown>>): SpanningActivity[] {
  const spans: SpanningActivity[] = [];
  
  for (const activity of activities) {
    const startDate = activity.date as string | undefined;
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      continue;
    }
    
    const activityType = activity.activityType as string | undefined;
    const duration = activity.duration as string | undefined;
    const durationMinutes = activity.durationMinutes as number | undefined;
    
    let type: 'lodging' | 'flight' | 'rentalCar' | null = null;
    let spanDays = 0;
    
    if (activityType === 'lodging') {
      type = 'lodging';
      // Lodging: check for "nights" field or use duration
      const nights = activity.nights as number | undefined;
      if (typeof nights === 'number' && nights > 0) {
        spanDays = nights;
      } else {
        // Fall back to duration (e.g., "3 days" means 3 nights)
        spanDays = Math.floor(parseDurationToDays(duration, durationMinutes));
      }
    } else if (activityType === 'flight') {
      type = 'flight';
      // Flight: check for arrivalDate or use duration
      const arrivalDate = activity.arrivalDate as string | undefined;
      if (arrivalDate && /^\d{4}-\d{2}-\d{2}$/.test(arrivalDate)) {
        // Calculate days between departure and arrival
        const startMs = new Date(startDate + 'T00:00:00').getTime();
        const endMs = new Date(arrivalDate + 'T00:00:00').getTime();
        spanDays = Math.max(0, (endMs - startMs) / (24 * 60 * 60 * 1000));
      } else {
        // Use duration - flights over ~18 hours likely span to next day
        const durationDays = parseDurationToDays(duration, durationMinutes);
        if (durationDays >= 0.75) { // 18 hours or more
          spanDays = Math.ceil(durationDays);
        }
      }
    } else if (activityType === 'rentalCar') {
      type = 'rentalCar';
      // Rental car: check for returnDate, days field, or duration
      const returnDate = activity.returnDate as string | undefined;
      if (returnDate && /^\d{4}-\d{2}-\d{2}$/.test(returnDate)) {
        const startMs = new Date(startDate + 'T00:00:00').getTime();
        const endMs = new Date(returnDate + 'T00:00:00').getTime();
        spanDays = Math.max(0, (endMs - startMs) / (24 * 60 * 60 * 1000));
      } else {
        const days = activity.days as number | undefined;
        if (typeof days === 'number' && days > 0) {
          spanDays = days - 1; // "6 days" means pickup day + 5 more days
        } else {
          const parsed = parseDurationToDays(duration, durationMinutes);
          spanDays = Math.floor(parsed);
          if (spanDays > 0) spanDays -= 1; // Same logic
        }
      }
    }
    
    if (type && spanDays > 0) {
      spans.push({
        activity,
        startDate,
        endDate: addDaysToDate(startDate, spanDays),
        type,
      });
    }
  }
  
  return spans;
}

function computeDaySummary(
  date: string,
  activities: Array<Record<string, unknown>>,
  activeSpans: SpanningActivity[]
): DaySummary {
  const dateObj = new Date(date + 'T00:00:00');
  const dayOfWeek = DAY_NAMES[dateObj.getDay()];
  
  // Filter by activity type - activities that START on this date
  const lodgings = activities.filter(a => a.activityType === 'lodging');
  const flights = activities.filter(a => a.activityType === 'flight');
  const rentalCars = activities.filter(a => a.activityType === 'rentalCar');
  const meals = activities.filter(a => a.activityType === 'meal');
  const visits = activities.filter(a => a.activityType === 'visit');
  const hikes = activities.filter(a => a.activityType === 'hike');
  
  // Get spanning activities that are ACTIVE on this date (not starting, but covering)
  const activeLodgingSpans = activeSpans.filter(s => s.type === 'lodging' && s.startDate !== date);
  const activeFlightSpans = activeSpans.filter(s => s.type === 'flight' && s.startDate !== date);
  const activeRentalCarSpans = activeSpans.filter(s => s.type === 'rentalCar' && s.startDate !== date);
  
  // Lodging analysis - include carried lodging from spans
  const hasLodgingToday = lodgings.length > 0;
  const hasCarriedLodging = activeLodgingSpans.length > 0;
  const hasPotentialLodging = hasLodgingToday || hasCarriedLodging;
  // Multiple lodging issue: more than one today, OR one today plus carried, OR multiple carried
  const totalLodgingCount = lodgings.length + activeLodgingSpans.length;
  const issueMoreThanOneLodging = totalLodgingCount > 1;
  const issueNoLodging = !hasPotentialLodging;
  
  // Lodging booked: check today's lodging or carried lodging
  let lodgingBooked = false;
  if (hasLodgingToday) {
    lodgingBooked = lodgings.some(l => l.status === 'booked' || l.status === 'completed');
  } else if (hasCarriedLodging) {
    lodgingBooked = activeLodgingSpans.some(s => {
      const status = s.activity.status as string | undefined;
      return status === 'booked' || status === 'completed';
    });
  }
  
  // Lodging city: prefer today's, fall back to carried
  let lodgingCity: string | null = null;
  if (hasLodgingToday) {
    lodgingCity = (lodgings[0].city as string) || (lodgings[0].location as string) || null;
  } else if (hasCarriedLodging) {
    const carriedLodging = activeLodgingSpans[0].activity;
    lodgingCity = (carriedLodging.city as string) || (carriedLodging.location as string) || null;
  }
  
  // Flight analysis - include multi-day flights
  const flightCount = flights.length + activeFlightSpans.length;
  const flightBooked = 
    flights.some(f => f.status === 'booked' || f.status === 'completed') ||
    activeFlightSpans.some(s => {
      const status = s.activity.status as string | undefined;
      return status === 'booked' || status === 'completed';
    });
  
  // Rental car analysis - include multi-day rentals
  const hasRentalCar = rentalCars.length > 0 || activeRentalCarSpans.length > 0;
  const issueMoreThanOneRentalCar = rentalCars.length > 1;
  
  // Check if any rental car (starting or spanning) is booked
  const rentalCarBooked = 
    rentalCars.some(r => r.status === 'booked' || r.status === 'completed') ||
    activeRentalCarSpans.some(s => {
      const status = s.activity.status as string | undefined;
      return status === 'booked' || status === 'completed';
    });
  
  // Activity counts
  const activityCount = activities.length;
  const activityUids = activities.map(a => a.uid as string).filter(Boolean);
  
  // Activities without times
  const activitiesWithoutTimes = activities.filter(a => !a.time).length;
  
  // Activities needing booking (not booked, completed, or cancelled)
  const activitiesNeedingBooking = activities.filter(a => {
    const status = a.status as string | undefined;
    return status !== 'booked' && status !== 'completed' && status !== 'cancelled';
  }).length;
  
  // Main activity - first visit or hike
  const mainActivities = [...visits, ...hikes];
  const mainActivityUid = mainActivities.length > 0 
    ? (mainActivities[0].uid as string) || null 
    : null;
  
  // Meals
  const mealsDiningOut = meals.length;
  const mealsNeedingReservation = meals.filter(m => 
    m.reservationNeeded === true && 
    m.status !== 'booked' && 
    m.status !== 'completed'
  ).length;
  
  // Cost - sum up all costs converted to USD
  let totalCostUSD = 0;
  for (const activity of activities) {
    const costUSD = activity.costUSD as number | undefined;
    if (typeof costUSD === 'number' && !isNaN(costUSD)) {
      totalCostUSD += costUSD;
    }
  }
  
  // Time range
  const times = activities
    .map(a => a.time as string | undefined)
    .filter((t): t is string => !!t && /^\d{2}:\d{2}/.test(t))
    .sort();
  const earliestTime = times.length > 0 ? times[0].slice(0, 5) : null;
  const latestTime = times.length > 0 ? times[times.length - 1].slice(0, 5) : null;
  
  // Status flags
  const hasIdeas = activities.some(a => a.status === 'idea');
  const hasCancelled = activities.some(a => a.status === 'cancelled');
  
  // Booked but moved: activities where status is booked/completed and date ≠ bookingDate
  const bookedButMoved = activities.filter(a => {
    const status = a.status as string | undefined;
    const isBooked = status === 'booked' || status === 'completed';
    if (!isBooked) return false;
    const bookingDate = a.bookingDate as string | undefined;
    if (!bookingDate) return false; // No bookingDate means we can't detect movement
    return bookingDate !== date;
  });
  const issueActivitiesWithMismatchedBookingDates = bookedButMoved
    .map(a => a.uid as string)
    .filter(Boolean)
    .join(' ');
  
  // Transport check - get all transport activities (including rental cars which count as transport)
  const transports = activities.filter(a => a.activityType === 'transport');
  const transportTimes = transports
    .map(a => a.time as string | undefined)
    .filter((t): t is string => !!t && /^\d{2}:\d{2}/.test(t))
    .sort();
  
  // Check for transport to lodging: if there's a lodging starting today with a time,
  // we need transport before that time (unless there's a rental car active)
  let issueNoTransportToLodging = false;
  if (hasLodgingToday) {
    for (const lodging of lodgings) {
      const lodgingTime = lodging.time as string | undefined;
      if (lodgingTime && /^\d{2}:\d{2}/.test(lodgingTime)) {
        // Need transport before this time, or a rental car
        const hasTransportBefore = transportTimes.some(t => t < lodgingTime);
        const hasRentalCarAvailable = hasRentalCar && rentalCarBooked;
        if (!hasTransportBefore && !hasRentalCarAvailable) {
          issueNoTransportToLodging = true;
          break;
        }
      }
    }
  }
  
  // Check for transport to flights: each flight needs transport AFTER the previous flight
  // (or from start of day for the first flight)
  let issueNoTransportToFlight = false;
  if (flights.length > 0) {
    // Sort flights by time
    const flightsWithTime = flights
      .map(f => ({ flight: f, time: f.time as string | undefined }))
      .filter((f): f is { flight: typeof f.flight; time: string } => 
        !!f.time && /^\d{2}:\d{2}/.test(f.time))
      .sort((a, b) => a.time.localeCompare(b.time));
    
    const hasRentalCarAvailable = hasRentalCar && rentalCarBooked;
    
    let previousFlightTime = '00:00'; // Start of day for first flight
    for (const { flight, time: flightTime } of flightsWithTime) {
      // Need transport between previousFlightTime and this flightTime
      const hasTransportInWindow = transportTimes.some(t => 
        t > previousFlightTime && t < flightTime
      );
      
      // For the first flight, also accept transport at exactly the start
      const isFirstFlight = previousFlightTime === '00:00';
      const hasTransportBefore = isFirstFlight 
        ? transportTimes.some(t => t < flightTime)
        : hasTransportInWindow;
      
      if (!hasTransportBefore && !hasRentalCarAvailable) {
        issueNoTransportToFlight = true;
        break;
      }
      
      // Update for next iteration - next flight needs transport after this one
      previousFlightTime = flightTime;
    }
  }
  
  return {
    date,
    dayOfWeek,
    hasPotentialLodging,
    lodgingBooked,
    issueMoreThanOneLodging,
    issueNoLodging,
    lodgingCity,
    flightCount,
    flightBooked,
    hasRentalCar,
    rentalCarBooked,
    issueMoreThanOneRentalCar,
    activityCount,
    activityUids,
    activitiesWithoutTimes,
    activitiesNeedingBooking,
    mainActivityUid,
    mealsDiningOut,
    mealsNeedingReservation,
    totalCostUSD: Math.round(totalCostUSD * 100) / 100,
    earliestTime,
    latestTime,
    hasIdeas,
    hasCancelled,
    issueActivitiesWithMismatchedBookingDates,
    issueNoTransportToLodging,
    issueNoTransportToFlight,
  };
}

/**
 * Format day summaries for prompt inclusion
 */
export function formatDaySummariesForPrompt(summaries: DaySummary[]): string {
  if (summaries.length === 0) {
    return 'No days with activities.';
  }
  
  const lines = summaries.map(s => {
    const parts: string[] = [
      `date="${s.date}"`,
      `day="${s.dayOfWeek}"`,
      `activities=${s.activityCount}`,
    ];
    
    // Only include non-default/interesting values
    if (s.hasPotentialLodging) {
      parts.push(`lodging=${s.lodgingBooked ? 'booked' : 'unbooked'}`);
      if (s.issueMoreThanOneLodging) parts.push('issue-moreThanOneLodging=true');
      if (s.lodgingCity) parts.push(`city="${s.lodgingCity}"`);
    } else {
      parts.push('issue-noLodging=true');
    }
    
    if (s.flightCount > 0) {
      parts.push(`flights=${s.flightCount}${s.flightBooked ? '(booked)' : ''}`);
    }
    if (s.hasRentalCar) {
      parts.push(`rentalCar=${s.rentalCarBooked ? 'booked' : 'unbooked'}`);
    }
    if (s.issueMoreThanOneRentalCar) parts.push('issue-moreThanOneRentalCar=true');
    
    if (s.activitiesWithoutTimes > 0) {
      parts.push(`noTime=${s.activitiesWithoutTimes}`);
    }
    if (s.activitiesNeedingBooking > 0) {
      parts.push(`needsBooking=${s.activitiesNeedingBooking}`);
    }
    
    if (s.mealsDiningOut > 0) {
      parts.push(`meals=${s.mealsDiningOut}`);
      if (s.mealsNeedingReservation > 0) {
        parts.push(`mealsNeedRes=${s.mealsNeedingReservation}`);
      }
    }
    
    if (s.totalCostUSD > 0) {
      parts.push(`costUSD=${s.totalCostUSD}`);
    }
    
    if (s.earliestTime && s.latestTime) {
      parts.push(`time=${s.earliestTime}-${s.latestTime}`);
    } else if (s.earliestTime) {
      parts.push(`time=${s.earliestTime}`);
    }
    
    if (s.hasIdeas) parts.push('hasIdeas=true');
    if (s.hasCancelled) parts.push('hasCancelled=true');
    if (s.issueActivitiesWithMismatchedBookingDates) {
      parts.push(`issue-mismatchedBookingDates="${s.issueActivitiesWithMismatchedBookingDates}"`);
    }
    if (s.issueNoTransportToLodging) parts.push('issue-noTransportToLodging=true');
    if (s.issueNoTransportToFlight) parts.push('issue-noTransportToFlight=true');
    
    if (s.activityCount > 0) {
      parts.push(`uids="${s.activityUids.join(' ')}"`);
    }
    
    return `{ ${parts.join(' ')} }`;
  });
  
  return lines.join('\n');
}
