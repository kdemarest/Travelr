export interface Activity {
  uid: string;
  activityType: string;
  name: string;
  date: string;
  time: string;
  durationMinutes?: number;
  duration?: string;
  description?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  status?: "idea" | "planned" | "booked" | "completed" | "cancelled";
  price?: number | string;
  currency?: string;
  currencyAndPrice?: string;
  paymentMade?: boolean;
  paymentMethod?: string;
  paymentDate?: string;
  notesUser?: string;
  notesAi?: string;
  important?: boolean | string;
}

export interface CountryInfo {
  country: string;
  id: string;
  countryAlpha2: string;
  currencyAlpha3: string;
  exchangeRateToUSD: number;
}

export interface DaySummary {
  date: string;
  dayOfWeek: string;
  hasPotentialLodging: boolean;
  lodgingBooked: boolean;
  issueMoreThanOneLodging: boolean;
  issueNoLodging: boolean;
  lodgingCity: string | null;
  flightCount: number;
  flightBooked: boolean;
  hasRentalCar: boolean;
  rentalCarBooked: boolean;
  issueMoreThanOneRentalCar: boolean;
  activityCount: number;
  activityUids: string[];
  activitiesWithoutTimes: number;
  activitiesNeedingBooking: number;
  mainActivityUid: string | null;
  mealsDiningOut: number;
  mealsNeedingReservation: number;
  totalCostUSD: number;
  earliestTime: string | null;
  latestTime: string | null;
  hasIdeas: boolean;
  hasCancelled: boolean;
  issueActivitiesWithMismatchedBookingDates: string;
  issueNoTransportToLodging: boolean;
  issueNoTransportToFlight: boolean;
}

export interface TripModel {
  tripId?: string;
  tripName: string;
  activities: Activity[];
  countries?: CountryInfo[];
  daySummaries?: DaySummary[];
}

export type PlanLine =
  | { kind: "undated"; label: string }
  | {
      kind: "dated";
      date: string;
      displayDate: string;
      fullDisplayDate: string;
      notation: string;
      activities: Activity[];
      primaryActivityUid?: string | null;
      markedCount?: number;
      isDateMarked?: boolean;
      // Indicator slots
      flightCount?: number;
      flightBooked?: boolean;
      hasRentalCar?: boolean;
      rentalCarBooked?: boolean;
      lodgingStatus?: "none" | "unbooked" | "booked" | "multiple";
      lodgingCity?: string;         // City name for lodging
      lodgingStartsHere?: boolean;  // Different or no lodging on prior day
      lodgingEndsHere?: boolean;    // Different or no lodging on next day
      mealCount?: number;
      mealsNeedingReservation?: number;
      hasDateMismatchIssue?: boolean;
      issueNoTransportToLodging?: boolean;
      issueNoTransportToFlight?: boolean;
    };
