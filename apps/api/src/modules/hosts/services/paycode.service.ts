import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import { createHmac, randomUUID } from "node:crypto";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import { hostProfiles, hostWallets, paycodes, walletLedger, type Paycode } from "../../../drizzle/schema";
import { PaymentProviderRegistry } from "../../payments/providers/payment-provider.registry";
import type { PaycodeResult } from "../../payments/providers/payment-provider.interface";
import { SecurityService } from "../../security/security.service";
import { WalletLedgerService } from "./wallet-ledger.service";

const DEFAULT_EXPIRY_HOURS = 24;

/** Cap on one reconciliation pass so a pathological backlog can't hold the sweep open indefinitely. */
const RECONCILE_BATCH_LIMIT = 500;

/**
 * Offline payout — hosts generate a Monnify Paycode redeemable for cash at
 * any Moniepoint POS agent, instead of a bank-transfer withdrawal. Same
 * money-safety shape as `HostWalletService.withdraw()`: insert-first
 * idempotency claim, OTP gate before the wallet is touched, advisory-locked
 * transaction, hash-chained ledger entry.
 *
 * Unlike a withdrawal, a paycode debit isn't necessarily terminal — the
 * host can cancel it (or it can expire unused), in which case the hold is
 * released with a compensating credit against the SAME ledger `sourceId`,
 * mirroring `RefundWebhookService`'s failed-refund reversal.
 *
 * Reconciliation (flipping an unredeemed pending code to expired/success)
 * happens two ways, both converging on `terminatePaycode`: lazily whenever
 * a host's own paycodes are read (`reconcileHostExpired`), and on a fixed
 * 5-minute cadence across every host via `reconcileAllExpiredPaycodes`
 * (`PaycodeSweepProcessor`) — so a host's balance is corrected even if they
 * never reopen the app.
 */
@Injectable()
export class PaycodeService {
  private readonly logger = new Logger(PaycodeService.name);

  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly registry: PaymentProviderRegistry,
    private readonly security: SecurityService,
    private readonly ledger: WalletLedgerService,
    private readonly config: ConfigService,
  ) {}

  // ─── create ───────────────────────────────────────────────────────

  /**
   * Same insert-first idempotency + OTP-then-money-movement shape as
   * `HostWalletService.withdraw()`. `otpCode` is verified against the
   * `create_paycode` purpose — distinct from `withdraw_funds` since this is
   * a different money-out action, but the same "gate the movement, not the
   * read" posture.
   */
  async createPaycode(
    userId: string,
    input: { amountKobo: number; idempotencyKey: string; otpCode: string },
  ): Promise<{ paycode: Paycode; cached: boolean }> {
    const host = await this.requireHost(userId);

    const [profile] = await this.db
      .select({ displayName: hostProfiles.displayName })
      .from(hostProfiles)
      .where(eq(hostProfiles.id, host.id))
      .limit(1);
    const beneficiaryName = profile?.displayName ?? "Bookmi Host";

    const expiryHours =
      this.config.get<number>("monnify.paycodeExpiryHours") ?? DEFAULT_EXPIRY_HOURS;
    const expiresAt = new Date(Date.now() + expiryHours * 60 * 60 * 1000);
    const paycodeReference = `pc_${randomUUID()}`;

    // Step 1 — claim the paycode by inserting the row.
    const [inserted] = await this.db
      .insert(paycodes)
      .values({
        hostId: host.id,
        amountKobo: input.amountKobo,
        beneficiaryName,
        paycodeReference,
        status: "pending",
        expiresAt,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({
        target: [paycodes.hostId, paycodes.idempotencyKey],
        // pc_host_idempotency_uniq is partial (WHERE idempotency_key IS NOT
        // NULL) — Postgres won't pick a partial index as the ON CONFLICT
        // arbiter without the matching predicate.
        where: sql`${paycodes.idempotencyKey} IS NOT NULL`,
      })
      .returning();

    if (!inserted) {
      const [cached] = await this.db
        .select()
        .from(paycodes)
        .where(
          and(eq(paycodes.hostId, host.id), eq(paycodes.idempotencyKey, input.idempotencyKey)),
        )
        .limit(1);
      if (!cached) {
        throw new BadRequestException(
          "Paycode creation state indeterminate — retry with a fresh idempotency key.",
        );
      }
      if (cached.amountKobo !== input.amountKobo) {
        throw new BadRequestException(
          "This idempotency key was already used for a different paycode amount — use a fresh idempotency key to create a new one.",
        );
      }
      return { paycode: cached, cached: true };
    }

    // Step 2 — OTP gate. Failure is pre-debit, so no money has moved — tear
    // down the claim row exactly like withdraw() does.
    try {
      await this.security.verifyAndConsume(userId, "create_paycode", input.otpCode);
    } catch (err) {
      await this.db.delete(paycodes).where(eq(paycodes.id, inserted.id));
      throw err;
    }

    // Step 3 — advisory lock the host, re-read balance, create + debit.
    try {
      const finalRow = await this.db.transaction(async (trx) => {
        await trx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${host.id}, 3))`);

        const [w] = await trx
          .select()
          .from(hostWallets)
          .where(eq(hostWallets.hostId, host.id))
          .limit(1);
        if (!w) {
          throw new BadRequestException("Host wallet vanished mid-creation.");
        }
        if (w.balanceKobo < input.amountKobo) {
          throw new BadRequestException(
            `Wallet balance ₦${(w.balanceKobo / 100).toFixed(2)} is below the paycode amount.`,
          );
        }

        const useRealApi = this.config.get<boolean>("monnify.usePaycodeApi") ?? false;
        const result = useRealApi
          ? await this.createRealPaycode({
              paycodeReference,
              beneficiaryName,
              amountMinor: input.amountKobo,
              expiresAt,
            })
          : mockCreatePaycode(paycodeReference, beneficiaryName, input.amountKobo, expiresAt);

        const now = new Date();
        const [paycodeRow] = await trx
          .update(paycodes)
          .set({
            monnifyTransactionReference: result.transactionReference,
            maskedPaycode: result.maskedPaycode,
            feeKobo: result.feeMinor ?? null,
            updatedAt: now,
          })
          .where(eq(paycodes.id, inserted.id))
          .returning();
        if (!paycodeRow) {
          throw new NotFoundException("Paycode row disappeared mid-update.");
        }

        // Debit the wallet through the immutable ledger — same tx so a
        // hash-chain gap can never happen without the paycode row rolling
        // back with it. Status "pending" — flipped to "success" on
        // redemption, or reversed by terminatePaycode on cancel/expiry.
        await this.ledger.appendEntry({
          trx,
          hostId: host.id,
          amountKobo: input.amountKobo,
          type: "debit",
          sourceType: "paycode",
          sourceMode: "paycode_redemption",
          sourceId: paycodeRow.id,
          status: "pending",
          memo: feeMemo(paycodeReference, result.feeMinor),
        });

        this.logger.log(
          `Paycode ${paycodeReference} created for host ${host.id}: ${input.amountKobo} kobo (${useRealApi ? "live" : "mock"}).`,
        );

        return paycodeRow;
      });

      return { paycode: finalRow, cached: false };
    } catch (err) {
      const reason = err instanceof Error ? err.message : "paycode creation failed";
      await this.markPaycodeFailed(inserted.id, reason);
      throw err;
    }
  }

  private async createRealPaycode(input: {
    paycodeReference: string;
    beneficiaryName: string;
    amountMinor: number;
    expiresAt: Date;
  }): Promise<PaycodeResult> {
    const provider = this.registry.get("monnify");
    if (!provider.createPaycode) {
      throw new ServiceUnavailableException("Paycodes unavailable — provider misconfigured.");
    }
    return provider.createPaycode(input);
  }

  // ─── cancel ───────────────────────────────────────────────────────

  /** Only reachable while `status === "pending"` — no OTP needed, since cancelling only returns money to the host's own balance. */
  async cancelPaycode(userId: string, paycodeId: string): Promise<Paycode> {
    const host = await this.requireHost(userId);
    const row = await this.requireOwnedPaycode(host.id, paycodeId);

    if (row.status !== "pending") {
      throw new BadRequestException(`Cannot cancel a paycode in "${row.status}" state.`);
    }

    const useRealApi = this.config.get<boolean>("monnify.usePaycodeApi") ?? false;
    if (useRealApi) {
      const provider = this.registry.get("monnify");
      if (!provider.cancelPaycode) {
        throw new ServiceUnavailableException("Paycodes unavailable — provider misconfigured.");
      }
      await provider.cancelPaycode(row.paycodeReference);
    }

    return this.terminatePaycode(row, "cancelled", `Paycode ${row.paycodeReference} cancelled`);
  }

  // ─── reveal (Get Clear Paycode) ────────────────────────────────────

  /**
   * OTP-gated under a SECOND purpose (`reveal_paycode`), distinct from the
   * one that gated creation — anyone who sees the clear code can walk into
   * an agent and cash it, so disclosing it gets its own re-auth even though
   * no money moves at reveal time. Never persisted — always fetched live
   * (or deterministically derived in mock mode) and returned directly.
   */
  async revealPaycode(
    userId: string,
    paycodeId: string,
    otpCode: string,
  ): Promise<{ clearPaycode: string }> {
    const host = await this.requireHost(userId);
    const row = await this.requireOwnedPaycode(host.id, paycodeId);

    if (row.status !== "pending") {
      throw new BadRequestException(`Cannot reveal a paycode in "${row.status}" state.`);
    }

    await this.security.verifyAndConsume(userId, "reveal_paycode", otpCode);

    const useRealApi = this.config.get<boolean>("monnify.usePaycodeApi") ?? false;
    if (!useRealApi) {
      return { clearPaycode: deriveMockCode(row.paycodeReference) };
    }

    const provider = this.registry.get("monnify");
    if (!provider.getClearPaycode) {
      throw new ServiceUnavailableException("Paycodes unavailable — provider misconfigured.");
    }
    const result = await provider.getClearPaycode(row.paycodeReference);
    if (!result.clearPaycode) {
      throw new ServiceUnavailableException("Monnify did not return a clear paycode.");
    }
    return { clearPaycode: result.clearPaycode };
  }

  // ─── read ─────────────────────────────────────────────────────────

  async listPaycodes(userId: string): Promise<Paycode[]> {
    const host = await this.requireHost(userId);
    await this.reconcileHostExpired(host.id);
    return this.db
      .select()
      .from(paycodes)
      .where(eq(paycodes.hostId, host.id))
      .orderBy(desc(paycodes.createdAt));
  }

  async getPaycode(userId: string, paycodeId: string): Promise<Paycode> {
    const host = await this.requireHost(userId);
    await this.reconcileHostExpired(host.id);
    return this.requireOwnedPaycode(host.id, paycodeId);
  }

  // ─── reconciliation (lazy + background sweep) ──────────────────────

  /** Lazy per-read reconciliation — scoped to one host, called from listPaycodes/getPaycode. */
  private async reconcileHostExpired(hostId: string): Promise<void> {
    const expired = await this.db
      .select()
      .from(paycodes)
      .where(
        and(eq(paycodes.hostId, hostId), eq(paycodes.status, "pending"), lt(paycodes.expiresAt, new Date())),
      );
    for (const row of expired) {
      await this.reconcileOneExpired(row);
    }
  }

  /**
   * Background sweep entry point — called every 5 minutes by
   * `PaycodeSweepProcessor`, across every host. Returns the number of rows
   * reconciled (0 most ticks) for logging/observability.
   */
  async reconcileAllExpiredPaycodes(): Promise<number> {
    const expired = await this.db
      .select()
      .from(paycodes)
      .where(and(eq(paycodes.status, "pending"), lt(paycodes.expiresAt, new Date())))
      .limit(RECONCILE_BATCH_LIMIT);

    for (const row of expired) {
      await this.reconcileOneExpired(row);
    }
    if (expired.length) {
      this.logger.log(`Paycode sweep reconciled ${expired.length} expired paycode(s).`);
    }
    return expired.length;
  }

  /**
   * Shared by both reconciliation paths. When the live API is on, confirms
   * with Monnify first — guards the race where redemption happened seconds
   * before expiry — rather than assuming expiry and wrongly crediting the
   * host back for cash they already collected.
   */
  private async reconcileOneExpired(row: Paycode): Promise<void> {
    const useRealApi = this.config.get<boolean>("monnify.usePaycodeApi") ?? false;
    if (useRealApi) {
      const provider = this.registry.get("monnify");
      if (provider.getPaycode) {
        try {
          const live = await provider.getPaycode(row.paycodeReference);
          if (live.status === "success") {
            await this.confirmRedeemed(row);
            return;
          }
        } catch (err) {
          this.logger.warn(
            `Could not confirm live status for paycode ${row.id} before expiring it: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
    await this.terminatePaycode(row, "expired", `Paycode ${row.paycodeReference} expired`);
  }

  private async confirmRedeemed(row: Paycode): Promise<void> {
    const [updated] = await this.db
      .update(paycodes)
      .set({ status: "success", updatedAt: new Date() })
      .where(and(eq(paycodes.id, row.id), eq(paycodes.status, "pending")))
      .returning();
    if (!updated) return;

    const [ledgerEntry] = await this.db
      .select()
      .from(walletLedger)
      .where(and(eq(walletLedger.sourceType, "paycode"), eq(walletLedger.sourceId, row.id)))
      .limit(1);
    if (ledgerEntry) {
      await this.ledger.updateStatus(ledgerEntry.id, "success");
    }
  }

  /**
   * Shared terminal-state transition for cancel + expiry. The `WHERE
   * status='pending'` guard on the update makes this idempotent against a
   * race between e.g. the sweep and a concurrent cancel request — only one
   * wins the update; the loser sees `updated` empty and returns the current
   * row without double-crediting. Copies `RefundWebhookService`'s
   * failed-refund reversal shape: flip the original debit's ledger status
   * (not hashed, so chain-safe), then append a brand-new credit entry with
   * the SAME `sourceId` to net the balance back.
   */
  private async terminatePaycode(
    row: Paycode,
    nextStatus: "cancelled" | "expired",
    memo: string,
  ): Promise<Paycode> {
    const [updated] = await this.db
      .update(paycodes)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(and(eq(paycodes.id, row.id), eq(paycodes.status, "pending")))
      .returning();

    if (!updated) {
      const [current] = await this.db.select().from(paycodes).where(eq(paycodes.id, row.id)).limit(1);
      return current ?? row;
    }

    const [ledgerEntry] = await this.db
      .select()
      .from(walletLedger)
      .where(and(eq(walletLedger.sourceType, "paycode"), eq(walletLedger.sourceId, row.id)))
      .limit(1);

    if (!ledgerEntry) {
      this.logger.warn(`Paycode ${row.id} terminated (${nextStatus}) but has no matching wallet_ledger entry.`);
      return updated;
    }

    await this.ledger.updateStatus(ledgerEntry.id, nextStatus === "cancelled" ? "cancelled" : "failed");

    await this.db.transaction(async (trx) => {
      await this.ledger.appendEntry({
        trx,
        hostId: row.hostId,
        amountKobo: row.amountKobo,
        type: "credit",
        sourceType: "paycode",
        sourceMode: "paycode_redemption",
        sourceId: row.id,
        memo,
      });
    });

    return updated;
  }

  private async markPaycodeFailed(paycodeId: string, reason: string): Promise<void> {
    const trimmed = reason.slice(0, 500);
    await this.db
      .update(paycodes)
      .set({ status: "failed", failureReason: trimmed, updatedAt: new Date() })
      .where(eq(paycodes.id, paycodeId));
  }

  // ─── internals ────────────────────────────────────────────────────

  private async requireHost(userId: string): Promise<{ id: string }> {
    const [host] = await this.db
      .select({ id: hostProfiles.id })
      .from(hostProfiles)
      .where(eq(hostProfiles.userId, userId))
      .limit(1);
    if (!host) throw new NotFoundException("Complete onboarding before using paycodes.");
    return host;
  }

  private async requireOwnedPaycode(hostId: string, paycodeId: string): Promise<Paycode> {
    const [row] = await this.db
      .select()
      .from(paycodes)
      .where(and(eq(paycodes.id, paycodeId), eq(paycodes.hostId, hostId)))
      .limit(1);
    if (!row) throw new NotFoundException("Paycode not found.");
    return row;
  }
}

// ─── mock (MONNIFY_USE_PAYCODE_API=false, the default) ────────────────

/**
 * Deterministic 8-digit code derived from the paycode's own reference —
 * same value every time for a given paycode, without ever persisting it.
 * Mirrors `mockReservedAccountPatch`'s "fabricate a plausible value so the
 * product flow demos end-to-end without live credentials" posture.
 */
function deriveMockCode(paycodeReference: string): string {
  const digest = createHmac("sha256", "bookmi-mock-paycode").update(paycodeReference).digest("hex");
  const numeric = parseInt(digest.slice(0, 8), 16) % 100_000_000;
  return String(numeric).padStart(8, "0");
}

function maskCode(code: string): string {
  if (code.length <= 4) return "•".repeat(code.length);
  return `${code.slice(0, 2)}${"•".repeat(code.length - 4)}${code.slice(-2)}`;
}

function mockCreatePaycode(
  paycodeReference: string,
  beneficiaryName: string,
  amountMinor: number,
  expiresAt: Date,
): PaycodeResult {
  return {
    paycodeReference,
    transactionReference: `mock_paycode_${paycodeReference}`,
    beneficiaryName,
    amountMinor,
    status: "pending",
    expiresAt,
    maskedPaycode: maskCode(deriveMockCode(paycodeReference)),
    raw: { mock: true },
  };
}

function feeMemo(paycodeReference: string, feeMinor: number | undefined): string {
  if (!feeMinor) return `Paycode ${paycodeReference}`;
  return `Paycode ${paycodeReference} — fee ₦${(feeMinor / 100).toFixed(2)}`;
}
