import { Inject, Injectable, Logger } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import { paycodes, walletLedger } from "../../../drizzle/schema";
import { WalletLedgerService } from "../../hosts/services/wallet-ledger.service";
import type { ParsedWebhook } from "../providers/payment-provider.interface";

/**
 * Reconciles paycode-domain webhooks (`parsed.domain === "paycode"`)
 * against the `paycodes` table and the matching `wallet_ledger` entry
 * created optimistically when the paycode was created
 * (`PaycodeService.createPaycode()`).
 *
 * This is a BEST-EFFORT path, not the only correctness guarantee — see the
 * OPEN RISK comment on `MonnifyProvider.parseWebhook`'s paycode branch.
 * `PaycodeService` also lazily reconciles on every read and a background
 * sweep runs every 5 minutes, so a webhook that never arrives (or arrives
 * with a shape slightly different from what's coded here) doesn't leave a
 * host's balance wrong forever.
 *
 * Duplicates `PaycodeService.terminatePaycode`'s shape rather than sharing
 * it — `PaymentsModule` cannot depend on `HostsModule` (the reverse
 * dependency already exists), the exact same constraint that already
 * keeps `RefundWebhookService` from sharing code with
 * `HostBookingsService.refundBooking`.
 */
@Injectable()
export class PaycodeWebhookService {
  private readonly logger = new Logger(PaycodeWebhookService.name);

  constructor(
    @Inject(SUPABASE_DB) private readonly db: SupabaseDb,
    private readonly ledger: WalletLedgerService,
  ) {}

  async reconcile(parsed: ParsedWebhook): Promise<{ handled: boolean; reason?: string }> {
    const [row] = await this.db
      .select()
      .from(paycodes)
      .where(eq(paycodes.paycodeReference, parsed.providerReference))
      .limit(1);
    if (!row) {
      return { handled: false, reason: "paycode not found for provider reference" };
    }

    // Idempotent against redelivery — a paycode already in a terminal state
    // is left alone (also guards against racing the lazy/sweep reconciler).
    if (row.status !== "pending") {
      return { handled: true };
    }

    if (parsed.status === "success") {
      return this.applyTerminal(row.id, "success");
    }

    // Anything else — the raw Monnify status string travels in
    // `parsed.failureReason` (see `parsePaycodeWebhook`'s OPEN RISK
    // comment). Default to "expired" for an unrecognized/absent value,
    // since that's the more common unattended-paycode outcome.
    const nextStatus: "cancelled" | "expired" =
      parsed.failureReason?.toUpperCase() === "CANCELLED" ? "cancelled" : "expired";
    return this.applyTerminal(row.id, nextStatus, true);
  }

  private async applyTerminal(
    paycodeId: string,
    nextStatus: "success" | "cancelled" | "expired",
    reversing = false,
  ): Promise<{ handled: boolean }> {
    const [updated] = await this.db
      .update(paycodes)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(and(eq(paycodes.id, paycodeId), eq(paycodes.status, "pending")))
      .returning();
    if (!updated) return { handled: true };

    const [ledgerEntry] = await this.db
      .select()
      .from(walletLedger)
      .where(and(eq(walletLedger.sourceType, "paycode"), eq(walletLedger.sourceId, paycodeId)))
      .limit(1);
    if (!ledgerEntry) {
      this.logger.warn(
        `Paycode ${paycodeId} reconciled to ${nextStatus} via webhook but has no matching wallet_ledger entry.`,
      );
      return { handled: true };
    }

    if (!reversing) {
      await this.ledger.updateStatus(ledgerEntry.id, "success");
      return { handled: true };
    }

    await this.ledger.updateStatus(ledgerEntry.id, nextStatus === "cancelled" ? "cancelled" : "failed");
    await this.db.transaction(async (trx) => {
      await this.ledger.appendEntry({
        trx,
        hostId: updated.hostId,
        amountKobo: updated.amountKobo,
        type: "credit",
        sourceType: "paycode",
        sourceMode: "paycode_redemption",
        sourceId: paycodeId,
        memo: `Paycode ${updated.paycodeReference} ${nextStatus} (webhook)`,
      });
    });
    return { handled: true };
  }
}
