import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import { refunds, walletLedger } from "../../../drizzle/schema";
import { WalletLedgerService } from "../../hosts/services/wallet-ledger.service";
import type { ParsedWebhook } from "../providers/payment-provider.interface";

/**
 * Reconciles `SUCCESSFUL_REFUND` / `FAILED_REFUND` provider webhooks
 * (`parsed.domain === "refund"`) against the `refunds` table and the
 * matching `wallet_ledger` entry created optimistically when the refund was
 * initiated (see `HostBookingsService.refundBooking()`'s opt-in
 * `MONNIFY_USE_REFUND_API=true` path).
 *
 * Only reachable via that opt-in path — the default `disburse()` path
 * always force-settles as `success` synchronously and never produces a
 * `refunds` row waiting to be resolved, so this reconciler has nothing to do
 * for it (a webhook for a disburse-path refund simply won't find a
 * non-terminal row and short-circuits at the idempotency check below, same
 * as any other unmatched/duplicate delivery).
 */
@Injectable()
export class RefundWebhookService {
  private readonly logger = new Logger(RefundWebhookService.name);

  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly ledger: WalletLedgerService,
  ) {}

  async reconcile(parsed: ParsedWebhook): Promise<{ handled: boolean; reason?: string }> {
    if (parsed.status !== "success" && parsed.status !== "failed") {
      // Refund webhooks only ever normalize to success/failed (see
      // `parseRefundWebhook`) — anything else would be a provider surprise.
      return { handled: false, reason: `unexpected refund webhook status ${parsed.status}` };
    }

    const [refund] = await this.db
      .select()
      .from(refunds)
      .where(eq(refunds.monnifyReference, parsed.providerReference))
      .limit(1);
    if (!refund) {
      return { handled: false, reason: "refund not found for provider reference" };
    }

    // Idempotent against redelivery — a refund already in a terminal state
    // is left alone.
    if (refund.status === "success" || refund.status === "failed") {
      return { handled: true };
    }

    const nextStatus: "success" | "failed" = parsed.status;

    const [updated] = await this.db
      .update(refunds)
      .set({
        status: nextStatus,
        failureReason:
          nextStatus === "failed" ? (parsed.failureReason ?? "Refund failed") : null,
        updatedAt: new Date(),
      })
      .where(eq(refunds.id, refund.id))
      .returning();
    if (!updated) {
      this.logger.warn(`Refund ${refund.id} disappeared mid-reconcile.`);
      return { handled: false, reason: "refund disappeared mid-reconcile" };
    }

    const [ledgerEntry] = await this.db
      .select()
      .from(walletLedger)
      .where(and(eq(walletLedger.sourceType, "refund"), eq(walletLedger.sourceId, refund.id)))
      .limit(1);

    if (!ledgerEntry) {
      this.logger.warn(
        `Refund ${refund.id} reconciled to ${nextStatus} but has no matching wallet_ledger entry.`,
      );
      return { handled: true };
    }

    await this.ledger.updateStatus(ledgerEntry.id, nextStatus);

    if (nextStatus === "failed") {
      // The refund was optimistically debited (ledger status "pending")
      // when initiated; now that it's genuinely failed, restore the host's
      // wallet balance with a compensating credit. `appendEntry`'s own
      // row lock on `host_wallets` is sufficient serialization on its own —
      // no extra advisory lock needed.
      //
      // Judgment call (flagged, not silently decided): this does NOT
      // auto-revert the booking's `canceled` status set optimistically at
      // initiate time — the host may have already acted on the
      // cancellation. The refund shows as `failed` in the dashboard for
      // manual follow-up instead.
      await this.db.transaction(async (trx) => {
        await this.ledger.appendEntry({
          trx,
          hostId: refund.hostId,
          amountKobo: refund.amountKobo,
          type: "credit",
          sourceType: "refund",
          sourceMode: "refund",
          sourceId: refund.id,
          memo: `Refund ${refund.id} failed — compensating credit`,
        });
      });
    }

    return { handled: true };
  }
}
