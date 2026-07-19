import type { Kobo } from "./money.js";

export type BookingStatus =
  | "pending"
  | "confirmed"
  | "canceled"
  | "failed"
  | "arrived"
  | "seated"
  | "completed"
  | "no_show";

export type BookingSource = "storefront" | "dashboard";

export interface Booking {
  id: string;
  code: string | null;
  hostId: string;
  serviceIds: string[];
  durationMinutes: number;
  source: BookingSource;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  customerNotes: string | null;
  slotStartAt: string | null;
  amountKobo: Kobo;
  platformFeeKobo: Kobo;
  netToHostKobo: Kobo;
  status: BookingStatus;
  paymentTransactionId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookingInput {
  serviceIds: string[];
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerNotes?: string;
  slotStartAt?: string;
  /**
   * Only used when any selected service is pay-what-you-want. Must be
   * >= sum of listed prices. Ignored (server-locked) otherwise.
   */
  amountKobo?: Kobo;
}

export interface CheckoutResponse {
  booking: {
    id: string;
    code: string;
  };
  payment: {
    reference: string;
    provider: string;
    amountMinor: Kobo;
    currency: string;
    status: string;
    accessCode?: string;
    authorizationUrl?: string;
  };
}

/** { time: 'HH:mm', available: boolean } — from the availability generator. */
export interface AvailabilitySlot {
  time: string;
  available: boolean;
}
