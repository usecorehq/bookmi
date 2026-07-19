import type { Kobo } from "./money.js";

/**
 * Normalized payment status across providers. Terminal states are
 * `success`, `failed`, `abandoned`, `reversed`. `success → reversed` is the
 * only allowed post-terminal transition (chargebacks).
 */
export type PaymentStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | "abandoned"
  | "reversed";

export type PaymentPurposeType = "booking_checkout";

/**
 * Mirror of `payment_transactions` — the single source of truth for money
 * lifecycle. Providers write only `providerReference`; the rest is owned
 * by PaymentsService.
 */
export interface PaymentTransaction {
  id: string;
  reference: string;
  providerCode: string;
  providerReference: string | null;
  status: PaymentStatus;
  amountMinor: Kobo;
  currency: string;
  feeMinor: Kobo | null;
  netAmountMinor: Kobo | null;
  countryCode: string;
  purposeType: PaymentPurposeType | string;
  purposeId: string | null;
  businessId: string | null;
  initiatorUserId: string;
  payerEmail: string;
  authorizationCode: string | null;
  accessCode: string | null;
  authorizationUrl: string | null;
  metadata: Record<string, unknown>;
  idempotencyKey: string | null;
  initiatedAt: string;
  providerInitiatedAt: string | null;
  verifiedAt: string | null;
  webhookReceivedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Append-only audit trail entry per transaction. */
export interface PaymentEvent {
  id: string;
  transactionId: string;
  eventType:
    | "initiated"
    | "provider_response"
    | "verified"
    | "webhook_received"
    | "status_changed"
    | "error"
    | "purpose_handled";
  fromStatus: PaymentStatus | null;
  toStatus: PaymentStatus | null;
  source: "client" | "admin" | "webhook" | "verify" | "system";
  payload: Record<string, unknown>;
  createdAt: string;
}

/** Raw webhook receipt — the idempotency edge, keyed on (provider, eventId). */
export interface PaymentWebhookEvent {
  id: string;
  providerCode: string;
  providerEventId: string;
  signature: string | null;
  rawPayload: Record<string, unknown>;
  receivedAt: string;
  processedAt: string | null;
  transactionId: string | null;
  error: string | null;
}

// ─── Wire types for /payments endpoints ──────────────────────────────

export interface InitiatePaymentRequest {
  purposeType: PaymentPurposeType;
  purposeId?: string;
  amountMinor: Kobo;
  currency?: string;
  countryCode?: string;
  businessId?: string;
  email: string;
  metadata?: Record<string, unknown>;
  callbackUrl?: string;
  idempotencyKey?: string;
  initiatorUserId?: string;
  checkoutMode?: "popup" | "checkout_url";
}

export interface InitiatePaymentResponse {
  reference: string;
  provider: string;
  amountMinor: Kobo;
  currency: string;
  status: PaymentStatus;
  accessCode?: string;
  authorizationUrl?: string;
}

// ─── Payouts ─────────────────────────────────────────────────────────

export type PayoutStatus = "initiated" | "processing" | "pending" | "success" | "failed";

export interface Payout {
  id: string;
  hostId: string;
  amountKobo: Kobo;
  destinationBankCode: string;
  destinationAccountNumber: string;
  monnifyReference: string | null;
  status: PayoutStatus;
  failureReason: string | null;
  /**
   * Client-supplied idempotency token. Same host + same key = same payout
   * row — a retried request hits the cached response rather than a second
   * disbursement. Null for legacy rows created before the ledger existed.
   */
  idempotencyKey: string | null;
  createdAt: string;
  updatedAt: string;
}
