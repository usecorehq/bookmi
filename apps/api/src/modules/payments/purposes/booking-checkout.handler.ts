import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, inArray, sql } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import {
  bookings,
  customers,
  hostWallets,
  services,
  type PaymentTransaction,
} from "../../../drizzle/schema";
import type { VerifyResult } from "../providers/payment-provider.interface";
import type {
  PaymentPurposeHandler,
  ResolveInitiateInput,
  ResolvedInitiate,
} from "./purpose-handler.interface";

export const BOOKING_CHECKOUT_PURPOSE = "booking_checkout" as const;

/**
 * The one purpose bookmi ships with. Owns:
 *
 *  - **authorizeInitiate:** service exists and is active. Anyone (including
 *    anonymous / guest customers) can pay, so no user-ownership check here —
 *    the initiator is the customer, not the host.
 *
 *  - **resolveInitiate:** server-locked pricing. Fixed price wins the client's
 *    number every time. Pay-what-you-want: client-supplied amount must be
 *    ≥ service.priceKobo, else BadRequest.
 *
 *  - **onSuccess:** stamp the booking `confirmed`, credit the host wallet by
 *    the net amount (price − platform fee). All in one advisory-locked tx so
 *    concurrent webhook + verify replays land the same numbers exactly once
 *    (idempotent: skip if booking already confirmed).
 *
 *  - **onFailure:** stamp the booking `failed`. No wallet mutation.
 *
 * The booking row is created by the /bookings endpoint BEFORE the payment
 * intent — its id rides in as `purposeId`.
 */
@Injectable()
export class BookingCheckoutHandler implements PaymentPurposeHandler {
  readonly purposeType = BOOKING_CHECKOUT_PURPOSE;
  private readonly logger = new Logger(BookingCheckoutHandler.name);

  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly config: ConfigService,
  ) {}

  async authorizeInitiate(input: ResolveInitiateInput): Promise<void> {
    if (!input.purposeId) {
      throw new BadRequestException("booking_checkout requires purposeId (booking id)");
    }

    const [booking] = await this.db
      .select({
        id: bookings.id,
        serviceIds: bookings.serviceIds,
        status: bookings.status,
      })
      .from(bookings)
      .where(eq(bookings.id, input.purposeId))
      .limit(1);

    if (!booking) throw new NotFoundException(`Booking ${input.purposeId} not found`);
    if (booking.status !== "pending") {
      // Already resolved — don't let someone re-initiate a settled booking.
      throw new BadRequestException(
        `Booking ${input.purposeId} is ${booking.status}, cannot start a new checkout`,
      );
    }
    if (!booking.serviceIds || booking.serviceIds.length === 0) {
      throw new BadRequestException(`Booking ${input.purposeId} has no services attached`);
    }

    const rows = await this.db
      .select({ id: services.id, active: services.active })
      .from(services)
      .where(inArray(services.id, booking.serviceIds));
    if (rows.length !== booking.serviceIds.length) {
      throw new NotFoundException(`One or more services for booking ${booking.id} vanished`);
    }
    if (rows.some((r) => !r.active)) {
      throw new BadRequestException("One or more selected services are not currently accepting bookings");
    }
  }

  async resolveInitiate(input: ResolveInitiateInput): Promise<ResolvedInitiate> {
    if (!input.purposeId) {
      throw new BadRequestException("booking_checkout requires purposeId (booking id)");
    }

    const [booking] = await this.db
      .select({
        hostId: bookings.hostId,
        serviceIds: bookings.serviceIds,
      })
      .from(bookings)
      .where(eq(bookings.id, input.purposeId))
      .limit(1);
    if (!booking) throw new NotFoundException(`Booking ${input.purposeId} not found`);

    const rows = await this.db
      .select({
        id: services.id,
        priceKobo: services.priceKobo,
        payWhatYouWant: services.payWhatYouWant,
      })
      .from(services)
      .where(inArray(services.id, booking.serviceIds));

    // Sum the listed prices across every selected service — that's the floor.
    // Multi-service bookings currently don't support pay-what-you-want per-item;
    // if ANY selected service is PWYW, the entire booking becomes PWYW with a
    // floor equal to the sum of listed prices.
    const listedTotal = rows.reduce((sum, r) => sum + r.priceKobo, 0);
    const anyPwyw = rows.some((r) => r.payWhatYouWant);

    let amountMinor: number;
    if (anyPwyw) {
      const requested = Math.floor(input.amountMinor);
      if (requested < listedTotal) {
        throw new BadRequestException(
          `Amount ${requested} kobo is below the ₦${(listedTotal / 100).toFixed(2)} floor for this booking`,
        );
      }
      amountMinor = requested;
    } else {
      amountMinor = listedTotal;
    }

    return {
      amountMinor,
      currency: "NGN",
      // Route audit + host-scoped queries through business_id.
      businessId: booking.hostId,
    };
  }

  async onSuccess(tx: PaymentTransaction, _result?: VerifyResult): Promise<void> {
    const purposeId = tx.purposeId;
    if (!purposeId) {
      this.logger.warn(`booking_checkout success without purposeId (tx=${tx.id})`);
      return;
    }

    const paidKobo = tx.amountMinor;
    const feeBps = this.config.get<number>("platform.feeBps") ?? 250;
    // Round half-up to keep the platform whole; the host gets the remainder.
    const platformFeeKobo = Math.round((paidKobo * feeBps) / 10_000);
    const netToHostKobo = paidKobo - platformFeeKobo;

    // Two writes must land atomically: booking transition + wallet credit.
    // Advisory-lock the booking id so concurrent verify + webhook finalizers
    // for the same booking serialize here and only one credit sticks.
    await this.db.transaction(async (trx) => {
      await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${purposeId}, 1))`);

      const [current] = await trx
        .select({
          id: bookings.id,
          hostId: bookings.hostId,
          customerId: bookings.customerId,
          status: bookings.status,
        })
        .from(bookings)
        .where(eq(bookings.id, purposeId))
        .limit(1);
      if (!current) {
        this.logger.warn(`Booking ${purposeId} missing at onSuccess for tx=${tx.id}`);
        return;
      }
      if (current.status === "confirmed") {
        // Replay: already credited on the first pass.
        return;
      }
      if (current.status !== "pending") {
        // Booking was canceled/failed between initiate and settlement — do
        // not credit. finalize() may still recognize this as a real success
        // upstream, but domain-side we honor the terminal state.
        this.logger.warn(
          `Booking ${purposeId} is ${current.status} at onSuccess — skipping credit`,
        );
        return;
      }

      await trx
        .update(bookings)
        .set({
          status: "confirmed",
          amountKobo: paidKobo,
          platformFeeKobo,
          netToHostKobo,
          paymentTransactionId: tx.id,
          updatedAt: new Date(),
        })
        .where(eq(bookings.id, purposeId));

      // Wallet upsert — a host's wallet row is expected to exist from
      // signup, but bookmi is tolerant during early runs.
      await trx
        .insert(hostWallets)
        .values({
          hostId: current.hostId,
          balanceKobo: netToHostKobo,
        })
        .onConflictDoUpdate({
          target: hostWallets.hostId,
          set: {
            balanceKobo: sql`${hostWallets.balanceKobo} + ${netToHostKobo}`,
            updatedAt: new Date(),
          },
        });

      // Roll up customer totals — cheap denormalization so the dashboard
      // can sort by top spender / most recent visit without a booking join.
      // Skipped when the booking wasn't customer-linked (legacy rows,
      // dashboard-manual bookings that skipped the customer step).
      if (current.customerId) {
        // `now()` inside the SQL template avoids serializing a JS Date as
        // a bind parameter — postgres-js only auto-serializes Date on
        // typed column assignments, not inside raw sql interpolations.
        await trx
          .update(customers)
          .set({
            totalBookings: sql`${customers.totalBookings} + 1`,
            totalSpentKobo: sql`${customers.totalSpentKobo} + ${paidKobo}`,
            lastBookingAt: new Date(),
            firstBookingAt: sql`COALESCE(${customers.firstBookingAt}, now())`,
            updatedAt: new Date(),
          })
          .where(eq(customers.id, current.customerId));
      }
    });
  }

  async onFailure(tx: PaymentTransaction, _result?: VerifyResult): Promise<void> {
    const purposeId = tx.purposeId;
    if (!purposeId) return;

    await this.db
      .update(bookings)
      .set({
        status: "failed",
        paymentTransactionId: tx.id,
        updatedAt: new Date(),
      })
      .where(and(eq(bookings.id, purposeId), eq(bookings.status, "pending")));
  }
}
