/**
 * Provider-agnostic payment adapter contract.
 *
 * Every provider (Monnify today) implements this. 
 * The orchestration layer (PaymentsService) never speaks provider
 * dialect — it only ever holds a PaymentProvider reference.
 *
 * All amounts are in **minor units** (kobo, cents) and integers.
 */

export type PaymentProviderCode = "monnify" | "paystack" | "flutterwave" | string;

export type NormalizedStatus =
  | "pending"
  | "processing"
  | "success"
  | "failed"
  | "abandoned"
  | "reversed";

export interface InitializeInput {
  /** OUR internal reference — providers may accept, echo, or ignore it. */
  reference: string;
  amountMinor: number;
  currency: string;
  email: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
  countryCode?: string;
  /**
   * Restrict the checkout to specific payment channels (e.g. ['card']).
   */
  channels?: string[];
}

export interface InitializeResult {
  providerReference: string;
  /** Popup access code (Paystack). Monnify popup uses our reference directly. */
  accessCode?: string;
  /** Fallback redirect URL for hosted checkout. */
  authorizationUrl?: string;
  raw: unknown;
}

export interface PaymentCardDetails {
  cardType?: string;
  last4?: string;
  expMonth?: string;
  expYear?: string;
  bank?: string;
  channel?: string;
  reusable?: boolean;
}

export interface VerifyResult {
  status: NormalizedStatus;
  providerReference: string;
  /**
   * The provider's OWN internal transaction id (Monnify: `transactionReference`,
   * distinct from `providerReference` which is bookmi's minted reference that
   * Monnify merely echoes back). Needed to call the dedicated refund API,
   * which addresses transactions by Monnify's own reference, not ours.
   */
  providerTransactionId?: string;
  amountMinor: number;
  currency: string;
  feeMinor?: number;
  netAmountMinor?: number;
  paidAt?: Date;
  authorizationCode?: string;
  customerCode?: string;
  card?: PaymentCardDetails;
  failureReason?: string;
  raw: unknown;
}

export interface ChargeAuthorizationInput {
  reference: string;
  authorizationCode: string;
  email: string;
  amountMinor: number;
  currency: string;
  metadata?: Record<string, unknown>;
}

export interface ParsedWebhook {
  providerEventId: string;
  providerReference: string;
  status: NormalizedStatus;
  eventName: string;
  /**
   * Which domain this event belongs to. Undefined (today's default) means
   * "payment transaction" — the historically only domain webhooks carried.
   * `"refund"` routes `PaymentsService.processWebhook` to
   * `RefundWebhookService` instead of the payment-transaction finalize path.
   */
  domain?: "refund";
  amountMinor?: number;
  currency?: string;
  feeMinor?: number;
  netAmountMinor?: number;
  paidAt?: Date;
  authorizationCode?: string;
  customerCode?: string;
  card?: PaymentCardDetails;
  failureReason?: string;
  /**
   * The provider's own transaction reference — see `VerifyResult.providerTransactionId`
   * for why this is distinct from `providerReference`.
   */
  providerTransactionId?: string;
  raw: unknown;
}

/**
 * Nigerian bank returned by the disbursement provider. `code` is the CBN /
 * NIBSS bank code (Monnify calls this `code`, e.g. `"044"` for Access Bank).
 * Not all providers include a logo URL — leave it undefined when absent.
 */
export interface Bank {
  code: string;
  name: string;
  logoUrl?: string | null;
}

/**
 * Single-transfer disbursement input. Providers wire this to their outbound
 * bank-transfer API (Monnify's `POST /api/v2/disbursements/single`).
 *
 * `reference` is client-minted and MUST be unique per attempted transfer —
 * providers use it as the idempotency key. Callers should mint something
 * like `refund:<bookingId>:<uuidv4-slice>` and persist it before firing.
 */
export interface DisburseInput {
  reference: string;
  amountMinor: number;
  currency?: string;
  destinationBankCode: string;
  destinationAccountNumber: string;
  destinationAccountName: string;
  /** Bank-statement narration (short, e.g. "Refund for booking #ABCD"). */
  narration?: string;
}

export interface DisburseResult {
  providerReference: string;
  status: "pending" | "processing" | "success" | "failed";
  raw?: unknown;
}

/**
 * Input to the dedicated refund API (Monnify: `POST /api/v1/refunds/initiate-refund`).
 * Distinct from `DisburseInput` — this addresses an *existing* transaction by
 * the provider's own reference rather than moving money to an arbitrary
 * destination account from scratch, though it still accepts an optional
 * destination override (Monnify docs: `destinationAccountNumber` /
 * `destinationAccountBankCode`) so a refund can still be redirected to a
 * different bank account, same as the `disburse` path does today.
 */
export interface RefundInput {
  /** Deterministic: `refund_<refundRow.id>` — unchanged from today's disburse reference. */
  refundReference: string;
  /** The provider's OWN id for the original transaction — see `VerifyResult.providerTransactionId`. */
  transactionReference: string;
  /** Omit for a full refund of the original transaction amount. */
  amountMinor?: number;
  /** Provider truncates to 64 chars. */
  reason: string;
  /** Provider truncates to 16 chars. */
  note?: string;
  destinationBankCode?: string;
  destinationAccountNumber?: string;
}

export interface RefundResult {
  providerReference: string;
  /** Matches `packages/shared-types` `RefundStatus` exactly. */
  status: "processing" | "success" | "failed";
  raw?: unknown;
}

export interface PaymentProvider {
  readonly code: PaymentProviderCode;

  initialize(input: InitializeInput): Promise<InitializeResult>;
  verify(providerReference: string): Promise<VerifyResult>;

  verifyWebhookSignature(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): boolean;
  parseWebhook(
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): ParsedWebhook;

  refund?(input: RefundInput): Promise<RefundResult>;

  /**
   * Reserved, unwired — poll a previously-initiated refund's status
   * (Monnify: `GET /api/v1/refunds/{reference}`). No poller is built this
   * round; the refund-webhook path (see `RefundWebhookService`) is the only
   * consumer of refund state today. Kept on the interface so a future
   * reconciliation job has a stable contract to call into.
   */
  getRefundStatus?(refundReference: string): Promise<RefundResult>;

  chargeAuthorization?(input: ChargeAuthorizationInput): Promise<VerifyResult>;

  /**
   * Disbursement helpers — payout account setup. Providers that don't support
   * transfers (or that we haven't wired transfers for yet) omit these.
   */
  listBanks?(): Promise<Bank[]>;
  resolveBankAccount?(input: {
    bankCode: string;
    accountNumber: string;
  }): Promise<{ accountName: string; bankName: string }>;

  /**
   * Initiate a single-transfer disbursement. Providers that don't support
   * transfers (or that we haven't wired transfers for yet) omit this — the
   * caller must check for undefined before invoking.
   */
  disburse?(input: DisburseInput): Promise<DisburseResult>;
}

export const PAYMENT_PROVIDERS = Symbol("PAYMENT_PROVIDERS");
