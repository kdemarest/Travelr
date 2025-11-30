export interface Activity {
  uid?: string;
  activityType?: string;
  name?: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  duration?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  status?: "idea" | "planned" | "booked" | "completed" | "cancelled";
  price?: number;
  currency?: string;
  currencyAndPrice?: string;
  paymentMade?: boolean;
  paymentMethod?: string;
  paymentDate?: string;
  notesUser?: string;
  notesAi?: string;
  [key: string]: unknown;
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
  issueActivitiesWithMismatchedBookingDates: string;  // space-separated UIDs where date ≠ bookingDate
  issueNoTransportToLodging: boolean;
  issueNoTransportToFlight: boolean;
}

export interface TripModel {
  tripName: string;
  tripId?: string;
  activities: Activity[];
  countries?: CountryInfo[];
  daySummaries?: DaySummary[];
}
