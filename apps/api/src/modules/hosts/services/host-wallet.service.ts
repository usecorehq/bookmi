import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, desc, eq, sql } from "drizzle-orm";
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
import { SecurityService } from "../../security/security.service";
import { WalletLedgerService } from "./wallet-ledger.service";

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
  private readonly logger = new Logger(HostWalletService.name);

  /**
   * Process-local bank-list cache. The list changes rarely (new bank codes
   * roll out maybe a few times a year), so we skip Redis and let each API
   * instance keep its own copy. On restart it refills on first request.
   */
  private banksCache: { items: Bank[]; expiresAt: number } | null = null;

  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly registry: PaymentProviderRegistry,
    private readonly security: SecurityService,
    private readonly ledger: WalletLedgerService,
    private readonly config: ConfigService,
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

  // ─── withdrawal ───────────────────────────────────────────────────

  /**
   * Pay the host from their wallet to their saved payout account. Same
   * insert-first idempotency pattern as refund: a `payouts` row is written
   * before Monnify is touched, keyed on (host_id, idempotency_key). A
   * retried request with the same key returns the cached row instead of
   * initiating a second disbursement. The Monnify reference is
   * deterministic (`payout:<row.id>`) so a broken-network retry also hits
   * provider-side dedup.
   *
   * Destination bank details come from `host_wallets` — the host has already
   * saved a verified payout account via PayoutSection. This closes off a
   * whole class of "swap the destination bank" attack surface.
   */
  async withdraw(
    userId: string,
    input: {
      amountKobo: number;
      idempotencyKey: string;
      otpCode: string;
    },
  ): Promise<{ payout: Payout; cached: boolean }> {
    const host = await this.requireHost(userId);

    const provider = this.registry.get("monnify");
    if (!provider.disburse) {
      throw new ServiceUnavailableException(
        "Withdrawals unavailable — provider misconfigured.",
      );
    }

    // Load the host's saved payout account. Missing = the host never set one
    // up. We deliberately re-load inside the transaction as well so we
    // notice a mid-flight change; this outer read is just for validation
    // before we ever touch the ledger.
    const [wallet] = await this.db
      .select()
      .from(hostWallets)
      .where(eq(hostWallets.hostId, host.id))
      .limit(1);
    if (
      !wallet ||
      !wallet.bankCode ||
      !wallet.bankAccountNumber ||
      !wallet.bankAccountName
    ) {
      throw new BadRequestException("Set up your payout account first.");
    }

    // Step 1 — claim the withdrawal by inserting a ledger row.
    const [inserted] = await this.db
      .insert(payouts)
      .values({
        hostId: host.id,
        amountKobo: input.amountKobo,
        destinationBankCode: wallet.bankCode,
        destinationAccountNumber: wallet.bankAccountNumber,
        idempotencyKey: input.idempotencyKey,
        status: "processing",
      })
      .onConflictDoNothing({
        target: [payouts.hostId, payouts.idempotencyKey],
        // po_host_idempotency_uniq is partial (WHERE idempotency_key IS NOT
        // NULL). Postgres won't pick a partial index as the ON CONFLICT
        // arbiter without the matching predicate — 42P10 otherwise.
        where: sql`${payouts.idempotencyKey} IS NOT NULL`,
      })
      .returning();

    if (!inserted) {
      const [cached] = await this.db
        .select()
        .from(payouts)
        .where(
          and(
            eq(payouts.hostId, host.id),
            eq(payouts.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (!cached) {
        throw new BadRequestException(
          "Withdrawal state indeterminate — retry with a fresh idempotency key.",
        );
      }
      // An idempotency key dedupes retries of the SAME request — it must
      // never silently paper over a materially different one (e.g. the host
      // corrected the amount after a failed attempt and resubmitted under
      // the same stale key). Surfacing the wrong cached row's amount/status
      // as if it belonged to this request is exactly the confusing-error
      // bug this guards against.
      if (cached.amountKobo !== input.amountKobo) {
        throw new BadRequestException(
          "This idempotency key was already used for a different withdrawal amount — use a fresh idempotency key to submit a new withdrawal.",
        );
      }
      return { payout: cached, cached: true };
    }

    // Step 2 — OTP gate. Failure is pre-disburse, so no money has moved —
    // tear down the claim row so the user can retry the modal with a fresh
    // OTP under the same idempotency key. Leaving the row as `failed` would
    // trap the key on the cached failure and every retry would come back as
    // "otp_failed" even after they type the right code.
    try {
      await this.security.verifyAndConsume(userId, "withdraw_funds", input.otpCode);
    } catch (err) {
      await this.db.delete(payouts).where(eq(payouts.id, inserted.id));
      throw err;
    }

    // Step 3 — advisory lock the host, re-read balance, disburse.
    try {
      const finalRow = await this.db.transaction(async (trx) => {
        await trx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtextextended(${host.id}, 2))`,
        );

        const [w] = await trx
          .select()
          .from(hostWallets)
          .where(eq(hostWallets.hostId, host.id))
          .limit(1);
        if (!w) {
          throw new BadRequestException("Host wallet vanished mid-withdrawal.");
        }
        if (w.balanceKobo < input.amountKobo) {
          throw new BadRequestException(
            `Wallet balance ₦${(w.balanceKobo / 100).toFixed(2)} is below the withdrawal amount.`,
          );
        }

        // Monnify's reference validator only accepts alphanumerics, `-`, and
        // `_` — no colons.
        const reference = `payout_${inserted.id}`;
        const narration = `Bookmi withdrawal ${inserted.id.slice(0, 8)}`;

        const result = await provider.disburse!({
          reference,
          amountMinor: input.amountKobo,
          currency: "NGN",
          destinationBankCode: w.bankCode!,
          destinationAccountNumber: w.bankAccountNumber!,
          destinationAccountName: w.bankAccountName!,
          narration,
        });

        if (result.status === "failed") {
          throw new BadRequestException(
            "Withdrawal disbursement failed — no funds were moved.",
          );
        }

        const now = new Date();
        // MVP: treat any non-failed provider status as success and debit
        // now. A proper implementation would wait for the webhook to flip
        // `pending/processing → success`; the ledger row is exactly what
        // that webhook handler would update.
        const [payoutRow] = await trx
          .update(payouts)
          .set({
            monnifyReference: result.providerReference,
            status: result.status,
            updatedAt: now,
          })
          .where(eq(payouts.id, inserted.id))
          .returning();
        if (!payoutRow) {
          throw new NotFoundException("Payout row disappeared mid-update.");
        }

        // Debit the wallet through the immutable ledger — same tx so a
        // hash-chain gap can never happen without the payout row rolling
        // back with it.
        await this.ledger.appendEntry({
          trx,
          hostId: host.id,
          amountKobo: input.amountKobo,
          type: "debit",
          sourceType: "payout",
          sourceMode: "withdrawal",
          sourceId: payoutRow.id,
          memo: `Withdrawal to ${w.bankAccountNumber?.slice(-4) ?? "----"}`,
        });

        this.logger.log(
          `Withdrawal ${reference} initiated for host ${host.id}: ${input.amountKobo} kobo, providerStatus=${result.status}`,
        );

        return payoutRow;
      });

      return { payout: finalRow, cached: false };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "withdrawal failed";
      await this.markPayoutFailed(inserted.id, reason);
      throw err;
    }
  }

  // ─── reserved account activation ─────────────────────────────────

  /**
   * Provisions a reserved/dedicated virtual account so third parties can pay
   * a host directly by bank transfer. Behind the `MONNIFY_USE_RESERVED_ACCOUNT_API`
   * flag (`monnify.useReservedAccountApi`):
   *
   *  - **on** — calls `provider.reserveAccount()` (real Monnify
   *    `POST /api/v2/bank-transfer/reserved-accounts`). Money that later lands
   *    in the account is reconciled into `wallet_ledger` by
   *    `ReservedAccountWebhookService` via the `RESERVED_ACCOUNT_TRANSACTION`
   *    webhook.
   *  - **off** (default) — fabricates a plausible reserved-account response
   *    so the product flow (pending-activation card → BVN form → dedicated
   *    account number) still demos end-to-end without live Monnify
   *    credentials. Nothing ever lands in a mock account, so no webhook
   *    reconciliation applies to it.
   *
   * Idempotent: if the host already has a reserved account, it's returned
   * as-is rather than re-provisioning (and the BVN is not overwritten).
   *
   * BVN is sensitive NDPR-regulated PII — it is persisted but NEVER logged.
   */
  async activateReservedAccount(
    userId: string,
    bvn: string,
    email?: string,
  ): Promise<HostWallet> {
    const host = await this.requireHost(userId);

    const [existing] = await this.db
      .select()
      .from(hostWallets)
      .where(eq(hostWallets.hostId, host.id))
      .limit(1);

    if (existing?.reservedAccountNumber) {
      // Already activated — idempotent no-op.
      return existing;
    }

    const useRealApi = this.config.get<boolean>("monnify.useReservedAccountApi") ?? false;
    const patch = useRealApi
      ? await this.reserveRealAccount(host.id, bvn, email)
      : mockReservedAccountPatch(bvn);

    const [row] = await this.db
      .insert(hostWallets)
      .values({ hostId: host.id, ...patch })
      .onConflictDoUpdate({ target: hostWallets.hostId, set: patch })
      .returning();

    // Never log the raw BVN.
    this.logger.log(
      `${useRealApi ? "Monnify" : "Mock"} reserved account provisioned for host ${host.id}`,
    );

    if (row) return row;
    const [again] = await this.db
      .select()
      .from(hostWallets)
      .where(eq(hostWallets.hostId, host.id))
      .limit(1);
    return again!;
  }

  private async reserveRealAccount(
    hostId: string,
    bvn: string,
    email: string | undefined,
  ): Promise<{
    bvn: string;
    reservedAccountNumber: string;
    reservedBankName: string;
    monnifyWalletReference: string;
    updatedAt: Date;
  }> {
    if (!email) {
      throw new BadRequestException(
        "An email address is required to activate a reserved account.",
      );
    }

    const provider = this.registry.get("monnify");
    if (!provider.reserveAccount) {
      throw new ServiceUnavailableException(
        "Reserved accounts unavailable — provider misconfigured.",
      );
    }

    const [profile] = await this.db
      .select({ displayName: hostProfiles.displayName })
      .from(hostProfiles)
      .where(eq(hostProfiles.id, hostId))
      .limit(1);
    const accountName = profile?.displayName ?? "Bookmi Host";
    const preferredBankCode = this.config.get<string>("monnify.reservedAccountBankCode");

    // accountReference = hostId — deterministic, unique, and lets
    // ReservedAccountWebhookService map a credit straight back to this host
    // with no side-table lookup.
    const result = await provider.reserveAccount({
      accountReference: hostId,
      accountName,
      customerEmail: email,
      customerName: accountName,
      bvn,
      ...(preferredBankCode ? { preferredBankCodes: [preferredBankCode] } : {}),
    });

    const primary = result.accounts[0];
    if (!primary) {
      throw new ServiceUnavailableException("Monnify returned no reserved account details.");
    }

    return {
      bvn,
      reservedAccountNumber: primary.accountNumber,
      reservedBankName: primary.bankName,
      monnifyWalletReference: result.accountReference,
      updatedAt: new Date(),
    };
  }

  private async markPayoutFailed(payoutId: string, reason: string): Promise<void> {
    const trimmed = reason.slice(0, 500);
    await this.db
      .update(payouts)
      .set({
        status: "failed",
        failureReason: trimmed,
        updatedAt: new Date(),
      })
      .where(eq(payouts.id, payoutId));
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

/**
 * MOCK — fabricates a plausible 10-digit account number + reference for the
 * `MONNIFY_USE_RESERVED_ACCOUNT_API=false` (default) path. Nothing ever lands
 * in this account; it exists only so the product flow demos end-to-end
 * without live Monnify credentials.
 */
function mockReservedAccountPatch(bvn: string): {
  bvn: string;
  reservedAccountNumber: string;
  reservedBankName: string;
  monnifyWalletReference: string;
  updatedAt: Date;
} {
  return {
    bvn,
    reservedAccountNumber: String(1_000_000_000 + Math.floor(Math.random() * 9_000_000_000)),
    reservedBankName: "Moniepoint MFB", // Monnify's documented default reserved-account partner bank.
    monnifyWalletReference: `mock_reserved_${crypto.randomUUID()}`,
    updatedAt: new Date(),
  };
}
