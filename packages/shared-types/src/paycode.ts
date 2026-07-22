import type { Kobo } from "./money.js";

/**
 * Mirrors Monnify's own Paycode status vocabulary, lowercased
 * (PENDING | SUCCESS | EXPIRED | CANCELLED), plus one bookmi-only state:
 * `failed`, for when the creation call itself failed and no code ever went
 * live.
 */
export type PaycodeStatus = "pending" | "success" | "expired" | "cancelled" | "failed";

/**
 * Wire type for a `paycodes` row. The unmasked/clear code is never part of
 * this shape — it only ever comes back from the dedicated reveal endpoint,
 * gated by its own OTP purpose.
 */
export interface Paycode {
  id: string;
  hostId: string;
  amountKobo: Kobo;
  feeKobo: Kobo | null;
  beneficiaryName: string;
  paycodeReference: string;
  monnifyTransactionReference: string | null;
  maskedPaycode: string | null;
  status: PaycodeStatus;
  failureReason: string | null;
  expiresAt: string;
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}
