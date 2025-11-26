export interface Activity {
  uid?: string;
  activityType?: string;
  name?: string;
  date?: string;
  time?: string;
  durationMinutes?: number;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  status?: "idea" | "planned" | "booked" | "completed" | "cancelled";
  price?: number;
  currency?: string;
  paymentMade?: boolean;
  paymentMethod?: string;
  paymentDate?: string;
  notesUser?: string;
  notesAi?: string;
  [key: string]: unknown;
}

export interface TripModel {
  tripName: string;
  tripId?: string;
  activities: Activity[];
}
