import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, eq, sql } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import {
  bookings,
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
        serviceId: bookings.serviceId,
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

    const [service] = await this.db
      .select({ id: services.id, active: services.active })
      .from(services)
      .where(eq(services.id, booking.serviceId))
      .limit(1);
    if (!service) throw new NotFoundException(`Service for booking ${booking.id} vanished`);
    if (!service.active) throw new BadRequestException("Service is not currently accepting bookings");
  }

  async resolveInitiate(input: ResolveInitiateInput): Promise<ResolvedInitiate> {
    if (!input.purposeId) {
      throw new BadRequestException("booking_checkout requires purposeId (booking id)");
    }

    const [row] = await this.db
      .select({
        hostId: bookings.hostId,
        priceKobo: services.priceKobo,
        payWhatYouWant: services.payWhatYouWant,
      })
      .from(bookings)
      .innerJoin(services, eq(services.id, bookings.serviceId))
      .where(eq(bookings.id, input.purposeId))
      .limit(1);
    if (!row) throw new NotFoundException(`Booking ${input.purposeId} not found`);

    const listed = row.priceKobo;
    let amountMinor: number;
    if (row.payWhatYouWant) {
      // Client sets the amount, but never below the listed price.
      const requested = Math.floor(input.amountMinor);
      if (requested < listed) {
        throw new BadRequestException(
          `Amount ${requested} kobo is below the ₦${(listed / 100).toFixed(2)} floor for this service`,
        );
      }
      amountMinor = requested;
    } else {
      amountMinor = listed;
    }

    return {
      amountMinor,
      currency: "NGN",
      // Route audit + host-scoped queries through business_id.
      businessId: row.hostId,
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
