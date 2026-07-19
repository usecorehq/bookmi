/**
 * All email payloads live in one discriminated union. Adding a new email:
 *   1. Add a new `kind` variant here.
 *   2. Add a `case` to `EmailsService.send()` that renders the template.
 *   3. Add a new file under `templates/`.
 *
 * The shape stays compatible with a BullMQ job payload so we can drop in a
 * queue later without changing callsites.
 */

export type EmailJob =
  | BookingConfirmedHostJob
  | BookingConfirmedCustomerJob
  | ResetPasswordJob
  | ConfirmEmailJob;
  
export interface ResetPasswordJob {
  kind: "reset_password";
  to: string;
  data: {
    email: string;
    code: string;
    verifyUrl: string;
  };
}

export interface ConfirmEmailJob {
  kind: "confirm_email";
  to: string;
  data: {
    email: string;
    code: string;
    verifyUrl: string;
  };
}
  
export interface BookingConfirmedHostJob {
  kind: "booking_confirmed_host";
  to: string;
  data: BookingConfirmedHostData;
}

export interface BookingConfirmedCustomerJob {
  kind: "booking_confirmed_customer";
  to: string;
  data: BookingConfirmedCustomerData;
}

// ─── Data shapes ───────────────────────────────────────────────────────

export interface BookingConfirmedHostData {
  hostDisplayName: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  services: Array<{ title: string; priceKobo: number; durationMinutes: number | null }>;
  slotStartAt: string | null;
  amountKobo: number;
  netToHostKobo: number;
  bookingCode: string;
  manageBookingUrl: string;
}

export interface BookingConfirmedCustomerData {
  customerName: string;
  hostDisplayName: string;
  hostSlug: string;
  hostPhone: string | null;
  hostAddress: string | null;
  services: Array<{ title: string; priceKobo: number; durationMinutes: number | null }>;
  slotStartAt: string | null;
  amountKobo: number;
  bookingCode: string;
  publicPageUrl: string;
}
