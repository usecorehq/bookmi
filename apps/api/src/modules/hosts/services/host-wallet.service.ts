import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
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
import { PaymentProviderRegistry } from "../../payments/providers/payment-provider.registry";
import type { Bank } from "../../payments/providers/payment-provider.interface";

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

const BANKS_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class HostWalletService {
  /**
   * Process-local bank-list cache. The list changes rarely (new bank codes
   * roll out maybe a few times a year), so we skip Redis and let each API
   * instance keep its own copy. On restart it refills on first request.
   */
  private banksCache: { items: Bank[]; expiresAt: number } | null = null;

  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly registry: PaymentProviderRegistry,
  ) {}

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

  // ─── payout setup ─────────────────────────────────────────────────

  /**
   * Cached bank list for the payout dropdown. Fresh for 24h, then refetched
   * from the provider on the next call.
   */
  async listBanks(): Promise<Bank[]> {
    const now = Date.now();
    if (this.banksCache && this.banksCache.expiresAt > now) {
      return this.banksCache.items;
    }
    const items = await this.callProviderListBanks();
    this.banksCache = { items, expiresAt: now + BANKS_TTL_MS };
    return items;
  }

  /**
   * Delegates to the provider — verification is a pure lookup, never
   * persisted here. The save step re-verifies before writing.
   */
  async verifyBankAccount(
    userId: string,
    bankCode: string,
    accountNumber: string,
  ): Promise<{ accountName: string; bankName: string }> {
    await this.requireHost(userId);
    return this.callProviderResolve({ bankCode, accountNumber });
  }

  /**
   * Persist the (bankCode, accountNumber, accountName) triple to
   * `host_wallets`. The account name is re-resolved server-side and must
   * match what the client sent (case-insensitive) — anything else means the
   * user tampered with the field or raced a stale verification.
   */
  async savePayoutAccount(
    userId: string,
    input: { bankCode: string; accountNumber: string; accountName: string },
  ): Promise<HostWallet> {
    const host = await this.requireHost(userId);

    const resolved = await this.callProviderResolve({
      bankCode: input.bankCode,
      accountNumber: input.accountNumber,
    });
    if (
      !resolved.accountName ||
      resolved.accountName.trim().toLowerCase() !== input.accountName.trim().toLowerCase()
    ) {
      throw new BadRequestException("Account name mismatch — please re-verify.");
    }

    const patch = {
      bankCode: input.bankCode,
      bankAccountNumber: input.accountNumber,
      // Store the provider-canonical spelling, not the client's.
      bankAccountName: resolved.accountName,
      updatedAt: new Date(),
    };

    const [row] = await this.db
      .insert(hostWallets)
      .values({ hostId: host.id, ...patch })
      .onConflictDoUpdate({ target: hostWallets.hostId, set: patch })
      .returning();

    if (row) return row;
    // Fallback in the unlikely case `returning()` yielded nothing (older PG
    // driver builds have surprised us here).
    const [again] = await this.db
      .select()
      .from(hostWallets)
      .where(eq(hostWallets.hostId, host.id))
      .limit(1);
    return again!;
  }

  // ─── internals ────────────────────────────────────────────────────

  private async requireHost(userId: string): Promise<{ id: string }> {
    const [host] = await this.db
      .select({ id: hostProfiles.id })
      .from(hostProfiles)
      .where(eq(hostProfiles.userId, userId))
      .limit(1);
    if (!host) throw new NotFoundException("Complete onboarding before setting up payouts.");
    return host;
  }

  private async callProviderListBanks(): Promise<Bank[]> {
    const provider = this.registry.get("monnify");
    if (!provider.listBanks) {
      throw new ServiceUnavailableException("Bank list unavailable — provider misconfigured.");
    }
    return provider.listBanks();
  }

  private async callProviderResolve(input: {
    bankCode: string;
    accountNumber: string;
  }): Promise<{ accountName: string; bankName: string }> {
    const provider = this.registry.get("monnify");
    if (!provider.resolveBankAccount) {
      throw new ServiceUnavailableException(
        "Account verification unavailable — provider misconfigured.",
      );
    }
    return provider.resolveBankAccount(input);
  }
}
