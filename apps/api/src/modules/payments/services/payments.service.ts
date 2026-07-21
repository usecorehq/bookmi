import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, sql } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import {
  countries,
  paymentEvents,
  paymentTransactions,
  paymentWebhookEvents,
  type PaymentStatus,
  type PaymentTransaction,
} from "../../../drizzle/schema";
import { PaymentProviderRegistry } from "../providers/payment-provider.registry";
import type {
  NormalizedStatus,
  ParsedWebhook,
  VerifyResult,
} from "../providers/payment-provider.interface";
import { PurposeHandlerRegistry } from "../purposes/purpose-handler.registry";
import {
  buildPaymentReference,
  type PaymentEnvironment,
} from "../payment-reference";
import { canTransition, isTerminal } from "./payment-state";
import { RefundWebhookService } from "./refund-webhook.service";

export interface InitiateInput {
  purposeType: string;
  purposeId?: string;
  amountMinor: number;
  currency?: string;
  countryCode?: string;
  businessId?: string;
  email: string;
  initiatorUserId: string;
  metadata?: Record<string, unknown>;
  idempotencyKey?: string;
  callbackUrl?: string;
  /** Restrict checkout channels (e.g. ['card']). */
  channels?: string[];
  /** How the client plans to run the checkout */
  checkoutMode?: "popup" | "checkout_url";
}

export interface InitiateResult {
  reference: string;
  provider: string;
  amountMinor: number;
  currency: string;
  status: PaymentStatus;
  accessCode?: string;
  authorizationUrl?: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly registry: PaymentProviderRegistry,
    private readonly purposes: PurposeHandlerRegistry,
    @Optional() private readonly config?: ConfigService,
    // @Optional() preserves the existing 3-arg constructor call in
    // payments-flow.int-spec.ts.
    @Optional() private readonly refundWebhooks?: RefundWebhookService,
  ) {}

  /** This deployment's environment — encoded into every reference it mints. */
  private appEnv(): PaymentEnvironment {
    return this.config?.get<PaymentEnvironment>("appEnv") ?? "prod";
  }

  // ─── Initiate ────────────────────────────────────────────────────

  async initiate(input: InitiateInput): Promise<InitiateResult> {
    // Idempotency at the client boundary — same (user, key) resumes the
    // existing transaction instead of creating a new one.
    if (input.idempotencyKey) {
      const existing = await this.findByIdempotencyKey(
        input.initiatorUserId,
        input.idempotencyKey,
      );
      if (existing) return this.resumeExisting(existing, input.callbackUrl);
    }

    const countryCode = input.countryCode ?? "NG";
    const country = await this.getCountryOrThrow(countryCode);
    const provider = await this.registry.resolveForCountry(countryCode);

    // Purpose handlers own their authorization (may this initiator pay for
    // this domain row?) and their pricing — the client amount is only trusted
    // for free-form purposes. Both run before anything is written.
    const handler = this.purposes.get(input.purposeType);
    const handlerInput = {
      purposeType: input.purposeType,
      purposeId: input.purposeId,
      amountMinor: input.amountMinor,
      currency: input.currency,
      businessId: input.businessId,
      initiatorUserId: input.initiatorUserId,
      metadata: input.metadata,
    };
    await handler.authorizeInitiate?.(handlerInput);
    const resolved = (await handler.resolveInitiate?.(handlerInput)) ?? {
      amountMinor: input.amountMinor,
      currency: input.currency,
      businessId: input.businessId,
    };

    const reference = buildPaymentReference(this.appEnv());

    let tx: PaymentTransaction;
    try {
      const [inserted] = await this.db
        .insert(paymentTransactions)
        .values({
          reference,
          providerCode: provider.code,
          status: "pending",
          amountMinor: resolved.amountMinor,
          currency: resolved.currency ?? input.currency ?? country.defaultCurrency,
          countryCode,
          purposeType: input.purposeType,
          purposeId: input.purposeId,
          businessId: resolved.businessId ?? input.businessId,
          initiatorUserId: input.initiatorUserId,
          payerEmail: input.email,
          // channels + checkout_mode ride in the metadata so an idempotent
          // resume reads back the same checkout intent (popup vs checkout_url).
          metadata: {
            ...(input.metadata ?? {}),
            ...(input.channels?.length ? { channels: input.channels } : {}),
            ...(input.checkoutMode ? { checkout_mode: input.checkoutMode } : {}),
          },
          idempotencyKey: input.idempotencyKey,
        })
        .returning();
      if (!inserted) throw new ConflictException("Failed to create payment transaction");
      tx = inserted;
    } catch (err) {
      // Concurrent initiate with the same idempotency key — the other request
      // won the pt_idempotency_uniq index. Return its transaction as-is.
      if (input.idempotencyKey && isUniqueViolation(err)) {
        const winner = await this.findByIdempotencyKey(
          input.initiatorUserId,
          input.idempotencyKey,
        );
        if (winner) return this.toInitiateResult(winner);
      }
      throw err;
    }

    await this.recordEvent(tx.id, "initiated", "client", {
      fromStatus: null,
      toStatus: "pending",
      payload: { purposeType: input.purposeType, provider: provider.code },
    });

    return this.initializeWithProvider(tx, input.callbackUrl);
  }

  /** Same (user, idempotency-key) came back — resume rather than recreate. */
  private async resumeExisting(
    tx: PaymentTransaction,
    callbackUrl?: string,
  ): Promise<InitiateResult> {
    if (tx.providerReference || tx.status !== "pending") return this.toInitiateResult(tx);
    return this.initializeWithProvider(tx, callbackUrl);
  }

  /** Call provider.initialize for a pending row and persist what it returns. */
  private async initializeWithProvider(
    tx: PaymentTransaction,
    callbackUrl?: string,
  ): Promise<InitiateResult> {
    const provider = this.registry.get(tx.providerCode);

    const txMeta = (tx.metadata ?? {}) as Record<string, unknown>;
    const channels = Array.isArray(txMeta.channels) ? (txMeta.channels as string[]) : undefined;
    let providerResult;
    try {
      providerResult = await provider.initialize({
        reference: tx.reference,
        amountMinor: tx.amountMinor,
        currency: tx.currency,
        email: tx.payerEmail,
        callbackUrl,
        metadata: {
          ...txMeta,
          reference: tx.reference,
          purposeType: tx.purposeType,
        },
        countryCode: tx.countryCode,
        channels,
      });
    } catch (err) {
      await this.recordEvent(tx.id, "error", "system", {
        payload: { stage: "provider.initialize", message: (err as Error).message },
      });
      throw err;
    }

    const [updated] = await this.db
      .update(paymentTransactions)
      .set({
        providerReference: providerResult.providerReference,
        accessCode: providerResult.accessCode ?? null,
        authorizationUrl: providerResult.authorizationUrl ?? null,
        providerInitiatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(paymentTransactions.id, tx.id))
      .returning();

    await this.recordEvent(tx.id, "provider_response", "system", {
      payload: {
        providerReference: providerResult.providerReference,
        kind: "initialize",
      },
    });

    return this.toInitiateResult(updated!);
  }

  // ─── Verify (client-triggered, e.g. Monnify popup onSuccess) ─────

  async verify(reference: string, requestingUserId?: string): Promise<PaymentTransaction> {
    const tx = await this.findByReferenceOrThrow(reference, requestingUserId);

    if (isTerminal(tx.status as PaymentStatus) || tx.status === "success") {
      return tx;
    }
    if (!tx.providerReference) {
      throw new BadRequestException("Transaction has not been sent to provider yet");
    }

    const provider = this.registry.get(tx.providerCode);
    const result = await provider.verify(tx.providerReference);

    await this.recordEvent(tx.id, "verified", "verify", {
      payload: {
        normalizedStatus: result.status,
        providerReference: result.providerReference,
      },
    });

    return this.finalize(tx.id, result);
  }

  // ─── Webhook (provider-pushed) ────────────────────────────────────

  async processWebhook(
    providerCode: string,
    rawBody: Buffer,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ handled: boolean; reason?: string }> {
    const provider = this.registry.get(providerCode);
    if (!provider.verifyWebhookSignature(rawBody, headers)) {
      throw new BadRequestException("Invalid webhook signature");
    }

    const parsed = provider.parseWebhook(rawBody, headers);
    const signature = firstHeader(headers, this.signatureHeaderFor(providerCode));

    // Edge-level dedup: unique (providerCode, providerEventId).
    let webhookRow;
    try {
      const [inserted] = await this.db
        .insert(paymentWebhookEvents)
        .values({
          providerCode,
          providerEventId: parsed.providerEventId,
          signature,
          rawPayload: parsed.raw as object,
        })
        .returning();
      webhookRow = inserted;
    } catch (err) {
      const [existing] = await this.db
        .select()
        .from(paymentWebhookEvents)
        .where(
          and(
            eq(paymentWebhookEvents.providerCode, providerCode),
            eq(paymentWebhookEvents.providerEventId, parsed.providerEventId),
          ),
        )
        .limit(1);
      if (existing?.processedAt) return { handled: false, reason: "duplicate" };
      webhookRow = existing;
      if (!webhookRow) throw err;
    }

    // Refund-domain events (SUCCESSFUL_REFUND/FAILED_REFUND) never touch a
    // payment_transactions row — route them to RefundWebhookService instead
    // of the payment-transaction finalize path below. Only reachable once
    // MONNIFY_USE_REFUND_API is on (see HostBookingsService.refundBooking);
    // the default disburse() path never produces a refund-domain webhook.
    if (parsed.domain === "refund") {
      if (!this.refundWebhooks) {
        await this.markWebhookProcessed(
          webhookRow!.id,
          "refund webhook received but RefundWebhookService is not wired",
        );
        return { handled: false, reason: "refund webhooks not wired" };
      }
      const result = await this.refundWebhooks.reconcile(parsed);
      await this.markWebhookProcessed(webhookRow!.id, result.handled ? null : (result.reason ?? "unhandled"));
      return result;
    }

    if (!parsed.providerReference) {
      const claimed = await this.offerUnmatchedEvent(providerCode, parsed);
      await this.markWebhookProcessed(
        webhookRow!.id,
        claimed ? null : "no provider_reference on event",
      );
      return { handled: claimed, reason: claimed ? undefined : "no provider_reference" };
    }

    const tx = await this.findByProviderReference(providerCode, parsed.providerReference);
    if (!tx) {
      const claimed = await this.offerUnmatchedEvent(providerCode, parsed);
      await this.markWebhookProcessed(
        webhookRow!.id,
        claimed ? null : "transaction not found",
      );
      return { handled: claimed, reason: claimed ? undefined : "transaction not found" };
    }

    await this.recordEvent(tx.id, "webhook_received", "webhook", {
      payload: { eventName: parsed.eventName, normalizedStatus: parsed.status },
    });

    await this.finalize(tx.id, verifyFromParsed(parsed), { webhookAt: new Date() });
    await this.markWebhookProcessed(webhookRow!.id, null, tx.id);

    return { handled: true };
  }

  // ─── Finalize (shared by verify + webhook) ────────────────────────

  private async finalize(
    txId: string,
    result: VerifyResult,
    extras: { webhookAt?: Date } = {},
  ): Promise<PaymentTransaction> {
    const source = extras.webhookAt ? "webhook" : "verify";

    // Serialize concurrent finalize calls for the same tx (verify + webhook
    // racing). Advisory lock is released at transaction end.
    const outcome = await this.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${txId}, 0))`);

      const [current] = await tx
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.id, txId))
        .limit(1);
      if (!current) throw new NotFoundException(`Transaction ${txId} not found`);

      const currentStatus = current.status as PaymentStatus;
      const nextStatus = result.status;

      // Replays of an already-settled status are pure no-ops.
      if (
        currentStatus === nextStatus &&
        (currentStatus === "success" || isTerminal(currentStatus))
      ) {
        return { row: current, transition: null };
      }
      if (!canTransition(currentStatus, nextStatus)) {
        this.logger.debug(`Skipping ${currentStatus} → ${nextStatus} on ${txId} (not allowed)`);
        return { row: current, transition: null };
      }

      // Never settle success on mismatched money.
      if (nextStatus === "success") {
        const amountMismatch =
          result.amountMinor > 0 && result.amountMinor !== current.amountMinor;
        const currencyMismatch =
          Boolean(result.currency) && result.currency !== current.currency;
        if (amountMismatch || currencyMismatch) {
          await tx.insert(paymentEvents).values({
            transactionId: txId,
            eventType: "error",
            source,
            payload: {
              reason: "amount_mismatch",
              expected: { amountMinor: current.amountMinor, currency: current.currency },
              reported: { amountMinor: result.amountMinor, currency: result.currency },
            },
          });
          this.logger.warn(
            `Refusing success on ${txId}: provider reported ${result.amountMinor} ${result.currency}, expected ${current.amountMinor} ${current.currency}`,
          );
          return { row: current, transition: null };
        }
      }

      const now = new Date();
      const [updated] = await tx
        .update(paymentTransactions)
        .set({
          status: nextStatus,
          feeMinor: result.feeMinor ?? current.feeMinor,
          netAmountMinor: result.netAmountMinor ?? current.netAmountMinor,
          authorizationCode: result.authorizationCode ?? current.authorizationCode,
          verifiedAt: extras.webhookAt ? current.verifiedAt : now,
          webhookReceivedAt: extras.webhookAt ?? current.webhookReceivedAt,
          completedAt:
            nextStatus === "success" || isTerminal(nextStatus)
              ? (result.paidAt ?? now)
              : current.completedAt,
          updatedAt: now,
        })
        .where(eq(paymentTransactions.id, txId))
        .returning();

      await tx.insert(paymentEvents).values({
        transactionId: txId,
        eventType: "status_changed",
        fromStatus: currentStatus,
        toStatus: nextStatus,
        source,
        payload: { providerReference: result.providerReference },
      });

      return { row: updated!, transition: { from: currentStatus, to: nextStatus } };
    });

    // Purpose side-effects run strictly AFTER the payments-DB commit. A
    // handler failure is audited and logged — it never unwinds the settled
    // payment status.
    if (outcome.transition) {
      try {
        await this.dispatchPurposeHandler(
          outcome.row,
          outcome.transition.to,
          outcome.transition.from,
          result,
        );
      } catch (err) {
        this.logger.error(
          `Purpose handler failed for tx=${outcome.row.id} purpose=${outcome.row.purposeType}: ${(err as Error).message}`,
          (err as Error).stack,
        );
        await this.recordEvent(outcome.row.id, "error", "system", {
          payload: { stage: "purpose_handler", message: (err as Error).message },
        }).catch(() => undefined);
      }
    }

    return outcome.row;
  }

  private async dispatchPurposeHandler(
    tx: PaymentTransaction,
    nextStatus: PaymentStatus,
    fromStatus: PaymentStatus,
    result: VerifyResult,
  ): Promise<void> {
    const handler = this.purposes.get(tx.purposeType);
    if (nextStatus === "success" && fromStatus !== "success") {
      await handler.onSuccess(tx, result);
      await this.recordEvent(tx.id, "purpose_handled", "system", {
        payload: { purposeType: tx.purposeType, outcome: "success" },
      });
    } else if (
      isTerminal(nextStatus) &&
      nextStatus !== "success" &&
      !isTerminal(fromStatus)
    ) {
      await handler.onFailure?.(tx, result);
      await this.recordEvent(tx.id, "purpose_handled", "system", {
        payload: { purposeType: tx.purposeType, outcome: nextStatus },
      });
    }
  }

  // ─── Read helpers ────────────────────────────────────────────────

  async findByReferenceOrThrow(
    reference: string,
    requestingUserId?: string,
  ): Promise<PaymentTransaction> {
    const [row] = await this.db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.reference, reference))
      .limit(1);
    // A reference owned by someone else reads as not-found — don't leak
    // existence of other users' transactions.
    if (!row || (requestingUserId && row.initiatorUserId !== requestingUserId)) {
      throw new NotFoundException(`Transaction ${reference} not found`);
    }
    return row;
  }

  private async findByIdempotencyKey(
    initiatorUserId: string,
    idempotencyKey: string,
  ): Promise<PaymentTransaction | null> {
    const [row] = await this.db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.initiatorUserId, initiatorUserId),
          eq(paymentTransactions.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async findByProviderReference(
    providerCode: string,
    providerReference: string,
  ): Promise<PaymentTransaction | null> {
    const [row] = await this.db
      .select()
      .from(paymentTransactions)
      .where(
        and(
          eq(paymentTransactions.providerCode, providerCode),
          eq(paymentTransactions.providerReference, providerReference),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  private async getCountryOrThrow(countryCode: string) {
    const [row] = await this.db
      .select()
      .from(countries)
      .where(eq(countries.code, countryCode))
      .limit(1);
    if (!row) throw new BadRequestException(`Unknown country: ${countryCode}`);
    if (!row.isActive) throw new BadRequestException(`Country ${countryCode} is disabled`);
    return row;
  }

  private async recordEvent(
    transactionId: string,
    eventType: string,
    source: string,
    body: {
      fromStatus?: PaymentStatus | null;
      toStatus?: PaymentStatus | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    await this.db.insert(paymentEvents).values({
      transactionId,
      eventType,
      source,
      fromStatus: body.fromStatus ?? null,
      toStatus: body.toStatus ?? null,
      payload: body.payload ?? {},
    });
  }

  private async offerUnmatchedEvent(
    providerCode: string,
    parsed: ParsedWebhook,
  ): Promise<boolean> {
    for (const handler of this.purposes.all()) {
      try {
        if (await handler.onUnmatchedProviderEvent?.(providerCode, parsed)) return true;
      } catch (err) {
        this.logger.error(
          `Unmatched-event handler ${handler.purposeType} failed for ${parsed.eventName}: ${(err as Error).message}`,
        );
      }
    }
    return false;
  }

  private async markWebhookProcessed(
    id: string,
    error: string | null,
    transactionId?: string,
  ): Promise<void> {
    await this.db
      .update(paymentWebhookEvents)
      .set({
        processedAt: new Date(),
        error,
        transactionId: transactionId ?? null,
      })
      .where(eq(paymentWebhookEvents.id, id));
  }

  private toInitiateResult(tx: PaymentTransaction): InitiateResult {
    return {
      reference: tx.reference,
      provider: tx.providerCode,
      amountMinor: tx.amountMinor,
      currency: tx.currency,
      status: tx.status as PaymentStatus,
      accessCode: tx.accessCode ?? undefined,
      authorizationUrl: tx.authorizationUrl ?? undefined,
    };
  }

  private signatureHeaderFor(providerCode: string): string {
    switch (providerCode) {
      case "paystack":
        return "x-paystack-signature";
      case "flutterwave":
        return "verif-hash";
      case "monnify":
        return "monnify-signature";
      default:
        return "";
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

function firstHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const v = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function verifyFromParsed(parsed: ParsedWebhook): VerifyResult {
  const s: NormalizedStatus = parsed.status;
  return {
    status: s,
    providerReference: parsed.providerReference,
    amountMinor: parsed.amountMinor ?? 0,
    currency: parsed.currency ?? "",
    feeMinor: parsed.feeMinor,
    netAmountMinor: parsed.netAmountMinor,
    paidAt: parsed.paidAt,
    authorizationCode: parsed.authorizationCode,
    raw: parsed.raw,
  };
}
