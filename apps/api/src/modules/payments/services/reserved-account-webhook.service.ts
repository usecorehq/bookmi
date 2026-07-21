import { Inject, Injectable, Logger } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import { hostWallets } from "../../../drizzle/schema";
import { WalletLedgerService } from "../../hosts/services/wallet-ledger.service";
import type { ParsedWebhook } from "../providers/payment-provider.interface";

/**
 * Reconciles `RESERVED_ACCOUNT_TRANSACTION` provider webhooks
 * (`parsed.domain === "reserved_account_credit"`) into `wallet_ledger` — a
 * transfer landing in a host's reserved account has no matching
 * `payment_transactions` row, so it can't go through the usual
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
    if (parsed.status !== "success") {
      // A failed/reversed reserved-account event never moved money — nothing
      // to reconcile into the ledger.
      return { handled: true };
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

    await this.db.transaction(async (trx) => {
      await this.ledger.appendEntry({
        trx,
        hostId,
        amountKobo: parsed.amountMinor!,
        type: "credit",
        sourceType: "reserved_account",
        sourceMode: "wallet_funding",
        sourceId: null,
        memo: `Reserved account transfer ${parsed.providerTransactionId ?? parsed.providerReference}`,
      });
    });

    return { handled: true };
  }
}
