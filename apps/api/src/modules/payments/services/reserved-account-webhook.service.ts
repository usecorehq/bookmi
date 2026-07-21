import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq, sql } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import { hostWallets, walletTopups } from "../../../drizzle/schema";
import { WalletLedgerService } from "../../hosts/services/wallet-ledger.service";
import type { ParsedWebhook } from "../providers/payment-provider.interface";

/**
 * Reconciles `RESERVED_ACCOUNT_TRANSACTION` provider webhooks
 * (`parsed.domain === "reserved_account_credit"`) into `wallet_topups` +
 * `wallet_ledger` — a transfer landing in a host's reserved account has no
 * matching `payment_transactions` row, so it can't go through the usual
 * verify/finalize path.
 *
 * Only reachable once a real reserved account exists, i.e. after
 * `HostWalletService.activateReservedAccount` ran with
 * `MONNIFY_USE_RESERVED_ACCOUNT_API=true` — mocked reserved accounts never
 * receive real transfers, so no webhook ever arrives for them.
 */
@Injectable()
export class ReservedAccountWebhookService {
  private readonly logger = new Logger(ReservedAccountWebhookService.name);

  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly ledger: WalletLedgerService,
  ) {}

  async reconcile(parsed: ParsedWebhook): Promise<{ handled: boolean; reason?: string }> {
    if (parsed.status !== "success" && parsed.status !== "failed") {
      // parseReservedAccountWebhook only ever normalizes to success/failed —
      // anything else would be a provider surprise.
      return { handled: false, reason: `unexpected reserved account webhook status ${parsed.status}` };
    }
    if (!parsed.accountReference) {
      return { handled: false, reason: "reserved account webhook missing account reference" };
    }
    if (!parsed.amountMinor || parsed.amountMinor <= 0) {
      return { handled: false, reason: "reserved account webhook missing amount" };
    }

    // accountReference is minted as the host's own id at reserve-account
    // creation time (see HostWalletService.activateReservedAccount) — no
    // side-table lookup needed to map it back to a host.
    const hostId = parsed.accountReference;
    const [wallet] = await this.db
      .select({ hostId: hostWallets.hostId })
      .from(hostWallets)
      .where(eq(hostWallets.hostId, hostId))
      .limit(1);
    if (!wallet) {
      return { handled: false, reason: `no host wallet for account reference ${hostId}` };
    }

    // `||` not `??` — parseReservedAccountWebhook can hand back an empty
    // string (not undefined) when Monnify omits transactionReference, and an
    // empty string would otherwise collide across every such event under
    // the (host_id, provider_reference) uniqueness check below.
    const providerReference =
      parsed.providerTransactionId || parsed.providerReference || null;

    if (parsed.status === "failed") {
      // No money moved — record for parity/audit with payouts/refunds, but
      // nothing to append to the ledger.
      await this.db
        .insert(walletTopups)
        .values({
          hostId,
          amountKobo: parsed.amountMinor,
          providerReference,
          status: "failed",
          failureReason: (parsed.failureReason ?? "Reserved account transfer failed").slice(0, 500),
          payerName: parsed.payerName ?? null,
        })
        .onConflictDoNothing({
          target: [walletTopups.hostId, walletTopups.providerReference],
          where: sql`${walletTopups.providerReference} IS NOT NULL`,
        });
      return { handled: true };
    }

    await this.db.transaction(async (trx) => {
      const [topup] = await trx
        .insert(walletTopups)
        .values({
          hostId,
          amountKobo: parsed.amountMinor!,
          providerReference,
          status: "success",
          payerName: parsed.payerName ?? null,
        })
        .onConflictDoNothing({
          target: [walletTopups.hostId, walletTopups.providerReference],
          where: sql`${walletTopups.providerReference} IS NOT NULL`,
        })
        .returning();

      if (!topup) {
        // Already recorded — a redelivered webhook. Idempotent no-op; do not
        // append a second ledger entry for the same transfer.
        return;
      }

      await this.ledger.appendEntry({
        trx,
        hostId,
        amountKobo: parsed.amountMinor!,
        type: "credit",
        sourceType: "reserved_account",
        sourceMode: "wallet_topup",
        sourceId: topup.id,
        memo: `Reserved account transfer ${providerReference ?? topup.id}`,
      });
    });

    return { handled: true };
  }
}
