import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, gte, ilike, inArray, lte, or, sql, SQL } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import {
  bookings,
  hostProfiles,
  services,
  type Booking,
  type BookingStatus,
} from "../../../drizzle/schema";
import { generateBookingCode } from "../booking-code";

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
  constructor(@Inject(SUPABASE_DB) private readonly db: SupabaseDb) {}

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
