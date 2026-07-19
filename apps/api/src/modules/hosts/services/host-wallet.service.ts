import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { desc, eq } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import {
  bookings,
  hostProfiles,
  hostWallets,
  payouts,
  type HostWallet,
  type Payout,
} from "../../../drizzle/schema";

export interface WalletView {
  wallet: HostWallet;
  recentBookings: Array<{
    id: string;
    code: string | null;
    customerName: string;
    amountKobo: number;
    netToHostKobo: number;
    slotStartAt: Date | null;
    status: string;
    createdAt: Date;
  }>;
  recentPayouts: Payout[];
}

@Injectable()
export class HostWalletService {
  constructor(@Inject(SUPABASE_DB) private readonly db: SupabaseDb) {}

  async get(userId: string): Promise<WalletView> {
    const [host] = await this.db
      .select({ id: hostProfiles.id })
      .from(hostProfiles)
      .where(eq(hostProfiles.userId, userId))
      .limit(1);
    if (!host) throw new NotFoundException("Complete onboarding before viewing your wallet.");

    let [wallet] = await this.db
      .select()
      .from(hostWallets)
      .where(eq(hostWallets.hostId, host.id))
      .limit(1);
    if (!wallet) {
      // Provision on first read — a signup right before this endpoint hit
      // might not have created the row yet.
      [wallet] = await this.db
        .insert(hostWallets)
        .values({ hostId: host.id })
        .onConflictDoNothing()
        .returning();
      if (!wallet) {
        const [again] = await this.db
          .select()
          .from(hostWallets)
          .where(eq(hostWallets.hostId, host.id))
          .limit(1);
        wallet = again!;
      }
    }

    const recentBookings = await this.db
      .select({
        id: bookings.id,
        code: bookings.code,
        customerName: bookings.customerName,
        amountKobo: bookings.amountKobo,
        netToHostKobo: bookings.netToHostKobo,
        slotStartAt: bookings.slotStartAt,
        status: bookings.status,
        createdAt: bookings.createdAt,
      })
      .from(bookings)
      .where(eq(bookings.hostId, host.id))
      .orderBy(desc(bookings.createdAt))
      .limit(10);

    const recentPayouts = await this.db
      .select()
      .from(payouts)
      .where(eq(payouts.hostId, host.id))
      .orderBy(desc(payouts.createdAt))
      .limit(10);

    return { wallet, recentBookings, recentPayouts };
  }
}
