import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import {
  bookings,
  customers,
  hostProfiles,
  type Booking,
  type Customer,
} from "../../../drizzle/schema";

/**
 * Per-host customer registry. Public checkout calls `resolveOrCreate` so
 * every storefront booking links to a durable customer row. Dashboard uses
 * `search` to autocomplete the "+ New Booking" modal.
 *
 * Dedup order (matches qore-menu): phone (unique-indexed) → email → create.
 * A 23505 on insert means a concurrent path just took the phone — we re-read
 * and link instead of failing the checkout.
 */
@Injectable()
export class CustomersService {
  constructor(@Inject(SUPABASE_DB) private readonly db: SupabaseDb) {}

  async resolveOrCreate(input: {
    hostId: string;
    name: string;
    phone?: string | null;
    email?: string | null;
    notes?: string | null;
  }): Promise<{ customerId: string; created: boolean }> {
    const name = input.name.trim() || "Guest";
    const phone = normalizePhone(input.phone);
    const email = input.email?.trim().toLowerCase() || null;
    const notes = input.notes?.trim() || null;

    // 1. phone lookup — unique-indexed per host
    if (phone) {
      const [byPhone] = await this.db
        .select({ id: customers.id })
        .from(customers)
        .where(and(eq(customers.hostId, input.hostId), eq(customers.phone, phone)))
        .limit(1);
      if (byPhone) return { customerId: byPhone.id, created: false };
    }

    // 2. email lookup — case-insensitive
    if (email) {
      const [byEmail] = await this.db
        .select({ id: customers.id })
        .from(customers)
        .where(
          and(
            eq(customers.hostId, input.hostId),
            sql`lower(${customers.email}) = ${email}`,
          ),
        )
        .limit(1);
      if (byEmail) return { customerId: byEmail.id, created: false };
    }

    // 3. create
    try {
      const [row] = await this.db
        .insert(customers)
        .values({
          hostId: input.hostId,
          name,
          phone,
          email,
          notes,
        })
        .returning({ id: customers.id });
      if (!row) throw new Error("Failed to insert customer.");
      return { customerId: row.id, created: true };
    } catch (err) {
      // Concurrent path took the phone between our lookup and insert — re-link.
      if (isUniqueViolation(err) && phone) {
        const [retry] = await this.db
          .select({ id: customers.id })
          .from(customers)
          .where(and(eq(customers.hostId, input.hostId), eq(customers.phone, phone)))
          .limit(1);
        if (retry) return { customerId: retry.id, created: false };
      }
      throw err;
    }
  }

  async listForUser(
    userId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<Customer[]> {
    const host = await this.requireHost(userId);
    return this.db
      .select()
      .from(customers)
      .where(eq(customers.hostId, host.id))
      .orderBy(desc(customers.lastBookingAt), desc(customers.createdAt))
      .limit(opts.limit ?? 50)
      .offset(opts.offset ?? 0);
  }

  async searchForUser(userId: string, q: string): Promise<Customer[]> {
    const host = await this.requireHost(userId);
    const term = q.trim();
    if (term.length < 2) return [];
    const pattern = `%${term}%`;
    return this.db
      .select()
      .from(customers)
      .where(
        and(
          eq(customers.hostId, host.id),
          or(
            ilike(customers.name, pattern),
            ilike(customers.phone, pattern),
            ilike(customers.email, pattern),
          ),
        ),
      )
      .orderBy(desc(customers.lastBookingAt))
      .limit(8);
  }

  async getByIdForUser(userId: string, customerId: string): Promise<Customer> {
    const host = await this.requireHost(userId);
    const [row] = await this.db
      .select()
      .from(customers)
      .where(and(eq(customers.id, customerId), eq(customers.hostId, host.id)))
      .limit(1);
    if (!row) throw new NotFoundException("Customer not found.");
    return row;
  }

  /**
   * Full booking history for a single customer. Ordered newest first so the
   * detail page renders recent activity at the top; capped so the payload
   * stays snappy for the customers with hundreds of visits.
   */
  async getBookingsForCustomer(
    userId: string,
    customerId: string,
    opts: { limit?: number } = {},
  ): Promise<Booking[]> {
    const host = await this.requireHost(userId);
    // Ownership gate — throws NotFound before we run the booking query.
    await this.getByIdForUser(userId, customerId);
    return this.db
      .select()
      .from(bookings)
      .where(and(eq(bookings.hostId, host.id), eq(bookings.customerId, customerId)))
      .orderBy(desc(bookings.createdAt))
      .limit(opts.limit ?? 100);
  }

  private async requireHost(userId: string) {
    const [host] = await this.db
      .select({ id: hostProfiles.id })
      .from(hostProfiles)
      .where(eq(hostProfiles.userId, userId))
      .limit(1);
    if (!host) throw new NotFoundException("Complete onboarding before managing customers.");
    return host;
  }
}

function normalizePhone(input?: string | null): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  return trimmed;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}
