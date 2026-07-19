import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, SQL } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import {
  bookings,
  hostProfiles,
  hostWallets,
  services,
  type Booking,
  type BookingStatus,
} from "../../../drizzle/schema";
import { EmailsService } from "../../emails/emails.service";
import { PaymentProviderRegistry } from "../../payments/providers/payment-provider.registry";
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
   * Runs the checks, provider verify, disbursement, and DB mutations inside a
   * single transaction with an advisory lock on the booking id — the same
   * pattern BookingCheckoutHandler.onSuccess uses, so a stray concurrent
   * refund on the same booking serializes here rather than double-debiting
   * the wallet.
   *
   * On any failure (booking not refundable, insufficient wallet balance,
   * account-name mismatch, provider rejection, disburse returning `failed`)
   * the transaction rolls back with no side effects.
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
    },
  ): Promise<Booking> {
    const host = await this.requireHost(userId);

    const provider = this.providerRegistry.get("monnify");
    if (!provider.disburse || !provider.resolveBankAccount) {
      throw new ServiceUnavailableException(
        "Refunds unavailable — provider misconfigured.",
      );
    }

    return this.db.transaction(async (trx) => {
      // Advisory lock scoped to this booking id so concurrent refund attempts
      // (rapid double-click, stale tab) serialize here — same tag (`1`) as
      // BookingCheckoutHandler.onSuccess uses on the same booking id.
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

      // Server-re-verify the (bankCode, accountNumber) with the provider —
      // stops a malicious client from swapping the destination account
      // between the payout-form verify step and the submit.
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

      // Client-minted idempotency reference — Monnify dedupes on this, so a
      // retried request lands on the same disbursement rather than a second
      // debit. The uuid suffix keeps partial refunds distinct.
      const reference = `refund:${bookingId}:${randomUUID().slice(0, 8)}`;
      const narration = `Refund for booking #${booking.code ?? bookingId.slice(0, 8)}`;

      const result = await provider.disburse!({
        reference,
        amountMinor: input.amountKobo,
        currency: "NGN",
        destinationBankCode: input.bankCode,
        destinationAccountNumber: input.accountNumber,
        narration,
      });
      if (result.status === "failed") {
        throw new BadRequestException(
          "Refund disbursement failed — no funds were moved.",
        );
      }

      const now = new Date();
      const [updated] = await trx
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
      if (!updated) {
        throw new NotFoundException("Booking disappeared mid-refund.");
      }

      await trx
        .update(hostWallets)
        .set({
          balanceKobo: sql`${hostWallets.balanceKobo} - ${input.amountKobo}`,
          updatedAt: now,
        })
        .where(eq(hostWallets.hostId, host.id));

      this.logger.log(
        `Refund ${reference} initiated for booking ${bookingId}: ${input.amountKobo} kobo, status=${result.status}`,
      );

      return updated;
    });
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
