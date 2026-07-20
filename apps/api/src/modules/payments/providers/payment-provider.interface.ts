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
  amountMinor?: number;
  currency?: string;
  feeMinor?: number;
  netAmountMinor?: number;
  paidAt?: Date;
  authorizationCode?: string;
  customerCode?: string;
  card?: PaymentCardDetails;
  failureReason?: string;
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

  refund?(
    providerReference: string,
    opts?: { amountMinor?: number; note?: string },
  ): Promise<void>;

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
