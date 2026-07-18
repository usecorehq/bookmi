/**
 * Provider-agnostic payment adapter contract.
 *
 * Every provider (Monnify today; Paystack/Flutterwave/Stripe later) implements
 * this. The orchestration layer (PaymentsService) never speaks provider
 * dialect — it only ever holds a PaymentProvider reference.
 *
 * All amounts are in **minor units** (kobo, cents) and integers.
 */

export type PaymentProviderCode = "paystack" | "flutterwave" | "monnify" | string;

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
}

export const PAYMENT_PROVIDERS = Symbol("PAYMENT_PROVIDERS");
