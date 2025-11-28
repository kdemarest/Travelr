export interface Activity {
  uid: string;
  activityType: string;
  name: string;
  date: string;
  time: string;
  durationMinutes?: number;
  description?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  status?: "idea" | "planned" | "booked" | "completed" | "cancelled";
  price?: number | string;
  currency?: string;
  paymentMade?: boolean;
  paymentMethod?: string;
  paymentDate?: string;
  notesUser?: string;
  notesAi?: string;
  important?: boolean | string;
}

export interface TripModel {
  tripId?: string;
  tripName: string;
  activities: Activity[];
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
    };
