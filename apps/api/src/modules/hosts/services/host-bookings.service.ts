import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, SQL } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import {
  bookings,
  hostProfiles,
  hostWallets,
  paymentTransactions,
  refunds,
  services,
  type Booking,
  type BookingStatus,
  type Refund,
} from "../../../drizzle/schema";
import { EmailsService } from "../../emails/emails.service";
import { PaymentProviderRegistry } from "../../payments/providers/payment-provider.registry";
import { SecurityService } from "../../security/security.service";
import { WalletLedgerService } from "./wallet-ledger.service";
import { generateBookingCode } from "../booking-code";

/** Statuses at which a paid booking can still be refunded to the customer. */
const REFUNDABLE_STATUSES = new Set<BookingStatus>([
  "confirmed",
  "arrived",
  "seated",
  "completed",
]);

const TERMINAL_STATUSES = new Set<BookingStatus>(["canceled", "failed", "no_show", "completed"]);

/**
 * Allowed status transitions for host-driven updates. The public checkout
 * flow moves `pending → confirmed/failed` via the payments handler; anything
 * beyond confirmed (arrived / seated / completed / canceled / no_show) is
 * host-only.
 */
const HOST_TRANSITIONS: Record<BookingStatus, BookingStatus[]> = {
  pending: ["canceled"],
  confirmed: ["arrived", "canceled", "no_show", "completed"],
  arrived: ["seated", "completed", "canceled", "no_show"],
  seated: ["completed", "canceled"],
  completed: [],
  canceled: [],
  failed: [],
  no_show: [],
};

@Injectable()
export class HostBookingsService {
  private readonly logger = new Logger(HostBookingsService.name);

  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly emails: EmailsService,
    private readonly config: ConfigService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly security: SecurityService,
    private readonly ledger: WalletLedgerService,
  ) {}

  async list(
    userId: string,
    filters: {
      status?: BookingStatus;
      source?: "storefront" | "dashboard";
      from?: string;
      to?: string;
      q?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<Booking[]> {
    const host = await this.requireHost(userId);
    const clauses: SQL[] = [eq(bookings.hostId, host.id)];
    if (filters.status) clauses.push(eq(bookings.status, filters.status));
    if (filters.source) clauses.push(eq(bookings.source, filters.source));
    if (filters.from) clauses.push(gte(bookings.slotStartAt, new Date(filters.from)));
    if (filters.to) clauses.push(lte(bookings.slotStartAt, new Date(filters.to)));
    if (filters.q) {
      const like = `%${filters.q}%`;
      const q = or(
        ilike(bookings.customerName, like),
        ilike(bookings.customerEmail, like),
        ilike(bookings.customerPhone, like),
      );
      if (q) clauses.push(q);
    }
    return this.db
      .select()
      .from(bookings)
      .where(and(...clauses))
      .orderBy(desc(bookings.createdAt))
      .limit(filters.limit ?? 100)
      .offset(filters.offset ?? 0);
  }

  async createManual(
    userId: string,
    input: {
      serviceIds: string[];
      durationMinutes: number;
      customerName: string;
      customerPhone: string;
      customerEmail?: string;
      customerNotes?: string;
      slotStartAt: string;
      amountKobo?: number;
    },
  ): Promise<Booking> {
    const host = await this.requireHost(userId);

    let resolvedAmount = input.amountKobo ?? 0;
    if (input.serviceIds.length > 0) {
      const rows = await this.db
        .select({ id: services.id, priceKobo: services.priceKobo, hostId: services.hostId })
        .from(services)
        .where(inArray(services.id, input.serviceIds));
      if (rows.length !== input.serviceIds.length) {
        throw new BadRequestException("One or more selected services not found.");
      }
      if (rows.some((r) => r.hostId !== host.id)) {
        throw new BadRequestException("A selected service belongs to another host.");
      }
      // Manual bookings default to the sum of listed prices; a client-supplied
      // override is honored (host may waive charges, add a tip, etc.).
      const sum = rows.reduce((s, r) => s + r.priceKobo, 0);
      if (input.amountKobo === undefined) resolvedAmount = sum;
    }

    const code = await this.insertWithCodeRetry(async (code) => {
      const [row] = await this.db
        .insert(bookings)
        .values({
          hostId: host.id,
          serviceIds: input.serviceIds,
          durationMinutes: input.durationMinutes,
          code,
          source: "dashboard",
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: (input.customerEmail || "").trim() || `noreply+${code}@bookmi.co`,
          customerNotes: input.customerNotes ?? null,
          slotStartAt: new Date(input.slotStartAt),
          amountKobo: resolvedAmount,
          status: "confirmed",
        })
        .returning();
      return row;
    });
    if (!code) throw new BadRequestException("Failed to create booking.");
    return code;
  }

  async updateStatus(
    userId: string,
    bookingId: string,
    input: { status?: BookingStatus; customerNotes?: string | null },
  ): Promise<Booking> {
    const host = await this.requireHost(userId);
    const [current] = await this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.hostId, host.id)))
      .limit(1);
    if (!current) throw new NotFoundException("Booking not found.");

    const patch: Partial<typeof bookings.$inferInsert> = { updatedAt: new Date() };

    if (input.status && input.status !== current.status) {
      const currentStatus = current.status as BookingStatus;
      if (TERMINAL_STATUSES.has(currentStatus)) {
        throw new BadRequestException(`Booking is ${currentStatus}; no further transitions allowed.`);
      }
      if (!HOST_TRANSITIONS[currentStatus].includes(input.status)) {
        throw new BadRequestException(`Cannot transition from ${currentStatus} to ${input.status}.`);
      }
      patch.status = input.status;
    }

    if (input.customerNotes !== undefined) patch.customerNotes = input.customerNotes;

    const [updated] = await this.db
      .update(bookings)
      .set(patch)
      .where(eq(bookings.id, bookingId))
      .returning();
    if (!updated) throw new NotFoundException("Booking disappeared mid-update.");
    return updated;
  }

  /**
   * Enqueue a "finish your booking" email to the customer for a pending
   * booking. Emits a `booking_payment_link` job carrying a `/pay/:bookingId`
   * URL — clicking it lands them on the public payment page, which resumes
   * checkout against THIS booking id (no new booking is created).
   *
   * Rejects anything not `pending` — a confirmed or canceled booking is
   * either already paid or terminal.
   */
  async sendPaymentLink(
    userId: string,
    bookingId: string,
  ): Promise<{ ok: true; email: string }> {
    const host = await this.requireHost(userId);
    const [booking] = await this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.hostId, host.id)))
      .limit(1);
    if (!booking) throw new NotFoundException("Booking not found.");
    if (booking.status !== "pending") {
      throw new BadRequestException(
        "Only pending bookings can be sent a payment link.",
      );
    }

    const [profile] = await this.db
      .select({
        displayName: hostProfiles.displayName,
      })
      .from(hostProfiles)
      .where(eq(hostProfiles.id, host.id))
      .limit(1);
    if (!profile) throw new NotFoundException("Host profile not found.");

    // First service on the booking is the customer-facing headline. Manual
    // bookings without an attached service fall back to a generic "Booking".
    const firstServiceId = booking.serviceIds?.[0];
    let serviceTitle = "Booking";
    if (firstServiceId) {
      const [svc] = await this.db
        .select({ title: services.title })
        .from(services)
        .where(eq(services.id, firstServiceId))
        .limit(1);
      if (svc) serviceTitle = svc.title;
    }

    const webBaseUrl =
      this.config.get<string>("web.baseUrl") ?? "http://localhost:5173";
    const payUrl = `${webBaseUrl}/pay/${booking.id}`;

    try {
      await this.emails.enqueue({
        kind: "booking_payment_link",
        to: booking.customerEmail,
        data: {
          customerName: booking.customerName,
          hostDisplayName: profile.displayName,
          serviceTitle,
          amountKobo: booking.amountKobo,
          bookingCode: booking.code ?? "",
          slotStartAt: booking.slotStartAt
            ? booking.slotStartAt.toISOString()
            : null,
          payUrl,
        },
      });
    } catch (err) {
      // The button re-enables on error — surface a 500 rather than pretend
      // we sent something we didn't.
      this.logger.error(
        `Failed to enqueue payment-link email for booking ${booking.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      throw err;
    }

    return { ok: true, email: booking.customerEmail };
  }

  /**
   * Send funds back to the customer's bank and mark the booking canceled.
   *
   * Insert-first ledger pattern: a `refunds` row is created BEFORE Monnify
   * is touched, keyed on (booking_id, idempotency_key). A retried request
   * with the same key finds the row already exists → we return the cached
   * response instead of triggering a second disbursement. The Monnify
   * reference is deterministic (`refund:<row.id>`), so even a broken-network
   * retry to Monnify hits provider-side dedup.
   *
   * The OTP verify runs ONCE per idempotency key: the retry path returns
   * the cached row without requiring a fresh OTP.
   *
   * On any failure the ledger row is marked `failed` with a reason — that
   * way a subsequent retry with the same key returns the failure instead of
   * silently succeeding.
   */
  async refundBooking(
    userId: string,
    bookingId: string,
    input: {
      bankCode: string;
      accountNumber: string;
      accountName: string;
      amountKobo: number;
      reason?: string;
      idempotencyKey: string;
      otpCode: string;
    },
  ): Promise<{ refund: Refund; booking: Booking | null; cached: boolean }> {
    const host = await this.requireHost(userId);

    // Rollout toggle — see A5 in the refund-API-rewire plan. Default false:
    // every existing deployment keeps calling `disburse()` exactly as it
    // does today until this is explicitly flipped on after a sandbox smoke
    // test. Only flip this on after confirming the two open risks noted on
    // `MonnifyProvider.refund()`/`parseRefundWebhook` against a real sandbox.
    const useRefundApi = this.config.get<boolean>("monnify.useRefundApi") ?? false;

    const provider = this.providerRegistry.get("monnify");
    if (useRefundApi) {
      if (!provider.refund || !provider.resolveBankAccount) {
        throw new ServiceUnavailableException(
          "Refunds unavailable — provider misconfigured.",
        );
      }
    } else if (!provider.disburse || !provider.resolveBankAccount) {
      throw new ServiceUnavailableException(
        "Refunds unavailable — provider misconfigured.",
      );
    }

    // Step 1 — try to claim the disbursement by inserting a ledger row. If
    // the (booking_id, idempotency_key) tuple already exists, ON CONFLICT
    // no-ops and we fall through to the cache path.
    const [inserted] = await this.db
      .insert(refunds)
      .values({
        bookingId,
        hostId: host.id,
        amountKobo: input.amountKobo,
        idempotencyKey: input.idempotencyKey,
        destinationBankCode: input.bankCode,
        destinationAccountNumber: input.accountNumber,
        destinationAccountName: input.accountName,
        reason: input.reason ?? null,
        status: "processing",
      })
      .onConflictDoNothing({
        target: [refunds.bookingId, refunds.idempotencyKey],
      })
      .returning();

    if (!inserted) {
      // Insert lost the race — return the cached row as-is.
      const [cached] = await this.db
        .select()
        .from(refunds)
        .where(
          and(
            eq(refunds.bookingId, bookingId),
            eq(refunds.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (!cached) {
        throw new BadRequestException(
          "Refund state indeterminate — retry with a fresh idempotency key.",
        );
      }
      // An idempotency key dedupes retries of the SAME request — it must
      // never silently paper over a materially different one (e.g. the host
      // reduced the amount after a failed attempt and resubmitted under the
      // same stale key). Without this check, a mismatched request would
      // surface the ORIGINAL attempt's stale status/failureReason as if it
      // belonged to the new one — a confusing, actively wrong error.
      if (
        cached.amountKobo !== input.amountKobo ||
        cached.destinationBankCode !== input.bankCode ||
        cached.destinationAccountNumber !== input.accountNumber
      ) {
        throw new BadRequestException(
          "This idempotency key was already used for a different refund amount or destination — use a fresh idempotency key to submit a new refund.",
        );
      }
      // Also fetch the associated booking so the client can render the
      // canceled state without a separate round-trip.
      const [bookingRow] = await this.db
        .select()
        .from(bookings)
        .where(eq(bookings.id, bookingId))
        .limit(1);
      return { refund: cached, booking: bookingRow ?? null, cached: true };
    }

    // Step 2 — OTP gate. Failure is pre-disburse, so no money has moved —
    // tear down the claim row so the operator can retry the modal with a
    // fresh OTP under the same idempotency key. Marking it failed would
    // trap the key on the cached "otp_failed" state and every retry would
    // come back as failed even after the right code is typed.
    try {
      await this.security.verifyAndConsume(userId, "refund_booking", input.otpCode);
    } catch (err) {
      await this.db.delete(refunds).where(eq(refunds.id, inserted.id));
      throw err;
    }

    // Step 3 — do the actual disbursement inside a transaction so wallet +
    // booking updates land atomically if we succeed.
    try {
      const finalRefund = await this.db.transaction(async (trx) => {
        // Advisory lock on booking id — same tag (`1`) as
        // BookingCheckoutHandler.onSuccess so concurrent refund attempts
        // serialize here.
        await trx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${bookingId}, 1))`,
        );

        const [booking] = await trx
          .select()
          .from(bookings)
          .where(and(eq(bookings.id, bookingId), eq(bookings.hostId, host.id)))
          .limit(1);
        if (!booking) throw new NotFoundException("Booking not found.");

        const currentStatus = booking.status as BookingStatus;
        if (!REFUNDABLE_STATUSES.has(currentStatus)) {
          throw new BadRequestException(
            `Cannot refund a booking that is ${currentStatus}.`,
          );
        }

        const alreadyRefunded = booking.refundedAmountKobo ?? 0;
        const remaining = booking.amountKobo - alreadyRefunded;
        if (input.amountKobo > remaining) {
          throw new BadRequestException(
            `Refund amount exceeds the ₦${(remaining / 100).toFixed(2)} refundable balance.`,
          );
        }

        const [wallet] = await trx
          .select()
          .from(hostWallets)
          .where(eq(hostWallets.hostId, host.id))
          .limit(1);
        if (!wallet) {
          throw new BadRequestException(
            "Host wallet not found — cannot refund without a source of funds.",
          );
        }
        if (wallet.balanceKobo < input.amountKobo) {
          throw new BadRequestException(
            `Wallet balance ₦${(wallet.balanceKobo / 100).toFixed(2)} is below the refund amount.`,
          );
        }

        // Server-re-verify (bankCode, accountNumber). Stops a malicious
        // client from swapping the destination between the payout-form
        // verify step and the submit.
        const resolved = await provider.resolveBankAccount!({
          bankCode: input.bankCode,
          accountNumber: input.accountNumber,
        });
        if (
          !resolved.accountName ||
          resolved.accountName.trim().toLowerCase() !==
            input.accountName.trim().toLowerCase()
        ) {
          throw new BadRequestException(
            "Account name mismatch — please re-verify.",
          );
        }

        // Deterministic Monnify reference — same idempotency key → same
        // ledger row id → same Monnify reference. Monnify dedupes on it,
        // so a broken-network retry lands on the same disbursement.
        // Monnify's validator only accepts alphanumerics, `-`, and `_`.
        const reference = `refund_${inserted.id}`;
        const narration = `Refund for booking #${booking.code ?? bookingId.slice(0, 8)}`;

        let result: {
          providerReference: string;
          status: "pending" | "processing" | "success" | "failed";
        };
        // `refunds.status` mirrors shared-types `RefundStatus` exactly
        // ("processing" | "success" | "failed"); `wallet_ledger.status`
        // (`LedgerEntryStatus`) has no "processing" value, so its
        // not-yet-resolved case uses "pending" instead. Both settle for
        // real once `RefundWebhookService` reconciles the provider's
        // refund webhook.
        let refundRowStatus: "success" | "processing";
        let ledgerEntryStatus: "success" | "pending";

        if (!useRefundApi) {
          // ─── Default path — byte-for-byte today's behavior, untouched ───
          result = await provider.disburse!({
            reference,
            amountMinor: input.amountKobo,
            currency: "NGN",
            destinationBankCode: input.bankCode,
            destinationAccountNumber: input.accountNumber,
            destinationAccountName: resolved.accountName,
            narration,
          });
          if (result.status === "failed") {
            throw new BadRequestException(
              "Refund disbursement failed — no funds were moved.",
            );
          }
          // MVP note: proper implementation would wait for the webhook to
          // flip `pending/processing` → `success` before debiting. For now
          // we treat any non-`failed` provider response as a green light
          // and debit immediately; the ledger row is exactly what a future
          // webhook handler updates.
          refundRowStatus = "success";
          ledgerEntryStatus = "success";
        } else {
          // ─── Opt-in path — MONNIFY_USE_REFUND_API=true only ───
          if (!booking.paymentTransactionId) {
            throw new BadRequestException(
              "This booking has no online payment on file — the provider refund API requires the original transaction. Legacy/dashboard-created bookings without an online payment can't use this path.",
            );
          }
          const [txRow] = await trx
            .select()
            .from(paymentTransactions)
            .where(eq(paymentTransactions.id, booking.paymentTransactionId))
            .limit(1);
          if (!txRow) {
            throw new NotFoundException("Original payment transaction not found.");
          }

          let providerTransactionId = txRow.providerTransactionId;
          if (!providerTransactionId) {
            // JIT backfill — rows written before this column existed (A2)
            // don't have it yet. One extra network call the first time an
            // old booking is refunded; persisted so later refunds skip it.
            if (!txRow.providerReference) {
              throw new BadRequestException(
                "Original payment transaction has no provider reference on file — cannot verify with the provider.",
              );
            }
            const verified = await provider.verify(txRow.providerReference);
            if (!verified.providerTransactionId) {
              throw new BadGatewayException(
                "Provider did not return a transaction reference — cannot initiate a refund via the provider API.",
              );
            }
            providerTransactionId = verified.providerTransactionId;
            await trx
              .update(paymentTransactions)
              .set({ providerTransactionId, updatedAt: new Date() })
              .where(eq(paymentTransactions.id, txRow.id));
          }

          result = await provider.refund!({
            refundReference: reference,
            transactionReference: providerTransactionId,
            amountMinor: input.amountKobo,
            reason: input.reason ?? narration,
            destinationBankCode: input.bankCode,
            destinationAccountNumber: input.accountNumber,
          });
          if (result.status === "failed") {
            throw new BadRequestException(
              "Refund disbursement failed — no funds were moved.",
            );
          }
          // Corrected mapping (only active on this path, see comment above
          // the variable declarations): a genuinely in-flight refund is
          // recorded as not-yet-settled instead of being falsely marked
          // `success` immediately like the disburse path always does.
          refundRowStatus = result.status === "success" ? "success" : "processing";
          ledgerEntryStatus = result.status === "success" ? "success" : "pending";
        }

        const now = new Date();
        const providerStatus = result.status;

        const [refundRow] = await trx
          .update(refunds)
          .set({
            monnifyReference: result.providerReference,
            status: refundRowStatus,
            updatedAt: now,
          })
          .where(eq(refunds.id, inserted.id))
          .returning();
        if (!refundRow) {
          throw new NotFoundException("Refund row disappeared mid-update.");
        }

        // Booking cancellation stays unconditional on initiate
        // success/processing, same as today, on both paths. If a later
        // FAILED_REFUND webhook arrives after this, RefundWebhookService
        // restores the wallet balance via a compensating credit but does
        // NOT auto-revert this cancellation — the host may have already
        // acted on it. The refund shows `failed` in the dashboard for
        // manual follow-up instead.
        const [updatedBooking] = await trx
          .update(bookings)
          .set({
            status: "canceled",
            refundedAmountKobo: alreadyRefunded + input.amountKobo,
            refundReason: input.reason ?? null,
            refundedAt: now,
            updatedAt: now,
          })
          .where(eq(bookings.id, bookingId))
          .returning();
        if (!updatedBooking) {
          throw new NotFoundException("Booking disappeared mid-refund.");
        }

        // Debit the wallet through the immutable ledger — same tx so the
        // refund row + booking transition + wallet delta commit as one.
        await this.ledger.appendEntry({
          trx,
          hostId: host.id,
          amountKobo: input.amountKobo,
          type: "debit",
          sourceType: "refund",
          sourceMode: "refund",
          sourceId: refundRow.id,
          status: ledgerEntryStatus,
          memo: `Refund for booking #${booking.code ?? bookingId.slice(0, 8)}`,
        });

        this.logger.log(
          `Refund ${reference} initiated for booking ${bookingId}: ${input.amountKobo} kobo, providerStatus=${providerStatus}`,
        );

        return { refund: refundRow, booking: updatedBooking };
      });

      return { refund: finalRefund.refund, booking: finalRefund.booking, cached: false };
    } catch (err) {
      // Any post-OTP failure lands on the ledger row so retries with the
      // same key surface the same reason instead of trying again.
      const reason = err instanceof Error ? err.message : "refund failed";
      await this.markFailed(inserted.id, reason);
      throw err;
    }
  }

  private async markFailed(refundId: string, reason: string): Promise<void> {
    // Truncate to keep long provider messages from bloating the row.
    const trimmed = reason.slice(0, 500);
    await this.db
      .update(refunds)
      .set({
        status: "failed",
        failureReason: trimmed,
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refundId));
  }

  async findByHostAndId(userId: string, bookingId: string): Promise<Booking> {
    const host = await this.requireHost(userId);
    const [row] = await this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.id, bookingId), eq(bookings.hostId, host.id)))
      .limit(1);
    if (!row) throw new NotFoundException("Booking not found.");
    return row;
  }

  /**
   * Retries booking insertion up to 3 times if the generated code collides.
   * Also used by the public checkout service via `insertBookingWithCode`.
   */
  async insertWithCodeRetry<T>(insert: (code: string) => Promise<T | undefined>): Promise<T | undefined> {
    for (let i = 0; i < 3; i++) {
      const code = generateBookingCode();
      try {
        const row = await insert(code);
        if (row) return row;
      } catch (err) {
        if (i === 2 || !isUniqueViolation(err)) throw err;
      }
    }
    return undefined;
  }

  private async requireHost(userId: string) {
    const [host] = await this.db
      .select({ id: hostProfiles.id })
      .from(hostProfiles)
      .where(eq(hostProfiles.userId, userId))
      .limit(1);
    if (!host) throw new NotFoundException("Complete onboarding before managing bookings.");
    return host;
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

// Keep sql import in play — it's expected by future queries that need raw
// expressions (e.g. array overlap checks).
void sql;
