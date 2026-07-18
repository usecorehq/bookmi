import type { PaymentTransaction } from "../../../drizzle/schema";
import type { ParsedWebhook, VerifyResult } from "../providers/payment-provider.interface";

/**
 * A purpose handler owns what happens after payment reaches a terminal state
 * for a specific `purposeType`. Handlers must be idempotent — the orchestrator
 * only calls them on genuine state transitions, but retries after crashes,
 * out-of-order webhooks, and admin-triggered replays are all possible.
 */
export interface ResolveInitiateInput {
  purposeType: string;
  purposeId?: string;
  /** Client-supplied amount — advisory only; handlers that know the true price MUST override it. */
  amountMinor: number;
  currency?: string;
  businessId?: string;
  initiatorUserId: string;
  metadata?: Record<string, unknown>;
}

export interface ResolvedInitiate {
  amountMinor: number;
  currency?: string;
  businessId?: string;
}

export interface PaymentPurposeHandler {
  readonly purposeType: string;

  /**
   * Authorization hook, called BEFORE resolveInitiate. Handlers whose purpose
   * touches privileged domain rows MUST verify the initiator is allowed and
   * throw ForbiddenException otherwise.
   */
  authorizeInitiate?(input: ResolveInitiateInput): Promise<void>;

  /**
   * Initiate-time pricing/veto hook. Handlers for purposes with a known price
   * MUST derive the amount here from their own domain rows.
   */
  resolveInitiate?(input: ResolveInitiateInput): Promise<ResolvedInitiate>;

  onSuccess(tx: PaymentTransaction, result?: VerifyResult): Promise<void>;
  onFailure?(tx: PaymentTransaction, result?: VerifyResult): Promise<void>;

  /**
   * Provider events that match no payment transaction are offered to every
   * handler. Return true when the event was claimed and applied.
   */
  onUnmatchedProviderEvent?(providerCode: string, parsed: ParsedWebhook): Promise<boolean>;
}

export const PAYMENT_PURPOSE_HANDLERS = Symbol("PAYMENT_PURPOSE_HANDLERS");
