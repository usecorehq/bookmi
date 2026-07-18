import type { Kobo } from "./money.js";

export type PaymentStatus = "initialized" | "paid" | "failed" | "refunded";

export interface Payment {
  id: string;
  reference: string;
  bookingId: string | null;
  hostId: string;
  amountKobo: Kobo;
  status: PaymentStatus;
  monnifyTransactionReference: string | null;
  createdAt: string;
  updatedAt: string;
}

export type PayoutStatus = "initiated" | "success" | "failed";

export interface Payout {
  id: string;
  hostId: string;
  amountKobo: Kobo;
  destinationBankCode: string;
  destinationAccountNumber: string;
  monnifyReference: string | null;
  status: PayoutStatus;
  createdAt: string;
  updatedAt: string;
}
