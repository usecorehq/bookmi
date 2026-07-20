import type { Kobo } from "./money.js";

/**
 * Durable customer row on the host's page. Populated automatically from
 * public checkouts (dedup'd by phone → email) and can be created manually
 * from the dashboard's "+ New Booking" modal.
 */
export interface Customer {
  id: string;
  hostId: string;
  name: string;
  phone: string | null;
  email: string | null;
  /** Host-authored notes (preferences, allergies). Not shown to the customer. */
  notes: string | null;
  totalBookings: number;
  totalSpentKobo: Kobo;
  firstBookingAt: string | null;
  lastBookingAt: string | null;
  createdAt: string;
  updatedAt: string;
}
