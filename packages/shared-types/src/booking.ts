import type { Kobo } from "./money.js";

export type BookingStatus = "pending" | "confirmed" | "canceled" | "failed";

export interface Booking {
  id: string;
  serviceId: string;
  hostId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string | null;
  slotStartAt: string | null;
  amountKobo: Kobo;
  platformFeeKobo: Kobo;
  netToHostKobo: Kobo;
  status: BookingStatus;
  paymentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBookingInput {
  serviceId: string;
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  slotStartAt?: string;
  /**
   * Only used when the service is pay-what-you-want. Must be >= service.priceKobo.
   * Ignored (server-locked) when the service is fixed-price.
   */
  amountKobo?: Kobo;
}

export interface InitBookingCheckoutResponse {
  bookingId: string;
  paymentReference: string;
  amountKobo: Kobo;
  monnify: {
    contractCode: string;
    apiKey: string;
  };
}
