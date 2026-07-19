import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import {
  bookings,
  hostProfiles,
  services,
  type Booking,
} from "../../../drizzle/schema";
import { generateBookingCode } from "../../hosts/booking-code";
import { PaymentsService } from "../../payments/services/payments.service";
import type { InitiateResult } from "../../payments/services/payments.service";
import { BOOKING_CHECKOUT_PURPOSE } from "../../payments/purposes/booking-checkout.handler";

interface CheckoutInput {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  customerNotes?: string;
  /** Required for booking services; ignored for tips. */
  slotStartAt?: string;
  /** Required for pay-what-you-want (tips + PWYW bookings). Otherwise ignored. */
  amountKobo?: number;
}

/**
 * Atomic public entrypoint for both booking + tip payments. Inserts the
 * pending bookings row first, then hands the id to `PaymentsService.initiate`
 * as the `purposeId` — the BookingCheckoutHandler owns pricing + settlement.
 *
 * Tips reuse the bookings table (slot_start_at IS NULL, duration=0). Cheaper
 * than a second purpose handler for the MVP; the calendar view filters them
 * out by `slot_start_at IS NOT NULL`.
 */
@Injectable()
export class PublicCheckoutService {
  private readonly logger = new Logger(PublicCheckoutService.name);

  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly payments: PaymentsService,
  ) {}

  async checkout(
    hostSlug: string,
    serviceSlug: string,
    input: CheckoutInput,
  ): Promise<{ booking: Booking; payment: InitiateResult }> {
    const { host, service } = await this.resolveHostAndService(hostSlug, serviceSlug);
    const serviceType = service.type as "booking" | "tip";

    if (serviceType === "booking") {
      if (!input.slotStartAt) {
        throw new BadRequestException("slotStartAt is required for booking services.");
      }
    }

    const amountKobo = this.resolveAmount({ ...service, type: serviceType }, input.amountKobo);

    const booking = await this.insertBooking({
      hostId: host.id,
      serviceId: service.id,
      serviceType,
      durationMinutes: service.durationMinutes ?? (serviceType === "tip" ? 0 : 60),
      slotStartAt: serviceType === "booking" ? new Date(input.slotStartAt!) : null,
      amountKobo,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      customerPhone: input.customerPhone ?? null,
      customerNotes: input.customerNotes ?? null,
    });

    // Fire the payment intent. The BookingCheckoutHandler validates + prices
    // it server-side. Anonymous checkout — initiatorUserId is the booking id
    // so idempotency keys are still per-checkout.
    const payment = await this.payments.initiate({
      purposeType: BOOKING_CHECKOUT_PURPOSE,
      purposeId: booking.id,
      amountMinor: amountKobo,
      currency: "NGN",
      countryCode: "NG",
      businessId: host.id,
      email: input.customerEmail,
      initiatorUserId: booking.id,
      idempotencyKey: `checkout:${booking.id}`,
      checkoutMode: "popup",
      metadata: {
        hostSlug,
        serviceSlug,
        serviceType,
        bookingCode: booking.code ?? undefined,
      },
    });

    return { booking, payment };
  }

  private resolveAmount(
    service: {
      type: "booking" | "tip";
      priceKobo: number;
      payWhatYouWant: boolean;
    },
    clientAmount?: number,
  ): number {
    // Tips are always PWYW with priceKobo as the FLOOR — the customer picks
    // ≥ that. Fixed-price bookings ignore client input; PWYW bookings use it
    // if it meets the floor.
    if (service.type === "tip" || service.payWhatYouWant) {
      if (!clientAmount) {
        throw new BadRequestException("Pick an amount to continue.");
      }
      if (clientAmount < service.priceKobo) {
        const floor = (service.priceKobo / 100).toFixed(2);
        throw new BadRequestException(`Amount must be at least ₦${floor}.`);
      }
      return clientAmount;
    }
    return service.priceKobo;
  }

  private async resolveHostAndService(hostSlug: string, serviceSlug: string) {
    const [host] = await this.db
      .select({ id: hostProfiles.id })
      .from(hostProfiles)
      .where(eq(hostProfiles.slug, hostSlug))
      .limit(1);
    if (!host) throw new NotFoundException("Page not found.");

    const [service] = await this.db
      .select({
        id: services.id,
        type: services.type,
        durationMinutes: services.durationMinutes,
        priceKobo: services.priceKobo,
        payWhatYouWant: services.payWhatYouWant,
        active: services.active,
      })
      .from(services)
      .where(and(eq(services.hostId, host.id), eq(services.slug, serviceSlug)))
      .limit(1);
    if (!service) throw new NotFoundException("Service not found on this page.");
    if (!service.active) {
      throw new BadRequestException("This service isn't accepting bookings right now.");
    }
    return { host, service };
  }

  /**
   * Retry on the (rare) global collision on `bookings.code` — the alphabet
   * gives ~30 bits per code so two picks colliding is a lottery-win event,
   * but we prove it can't wedge a checkout by retrying once.
   */
  private async insertBooking(input: {
    hostId: string;
    serviceId: string;
    serviceType: "booking" | "tip";
    durationMinutes: number;
    slotStartAt: Date | null;
    amountKobo: number;
    customerName: string;
    customerEmail: string;
    customerPhone: string | null;
    customerNotes: string | null;
  }): Promise<Booking> {
    for (let attempt = 0; attempt < 2; attempt++) {
      const code = generateBookingCode();
      try {
        const [row] = await this.db
          .insert(bookings)
          .values({
            hostId: input.hostId,
            serviceIds: [input.serviceId],
            durationMinutes: input.durationMinutes,
            code,
            source: "storefront",
            customerName: input.customerName,
            customerEmail: input.customerEmail,
            customerPhone: input.customerPhone,
            customerNotes: input.customerNotes,
            slotStartAt: input.slotStartAt,
            amountKobo: input.amountKobo,
            status: "pending",
          })
          .returning();
        if (!row) throw new Error("Failed to insert booking row.");
        return row;
      } catch (err) {
        if (isUniqueViolation(err) && attempt === 0) {
          this.logger.warn("Booking code collision — retrying with a fresh code.");
          continue;
        }
        throw err;
      }
    }
    throw new Error("Unable to allocate a booking code after retry.");
  }
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
