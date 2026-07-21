import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import * as schema from "../../src/drizzle/schema";
import {
  bookings,
  hostProfiles,
  hostWallets,
  refunds,
  walletLedger,
  type Refund,
} from "../../src/drizzle/schema";
import { PaymentsService } from "../../src/modules/payments/services/payments.service";
import { RefundWebhookService } from "../../src/modules/payments/services/refund-webhook.service";
import { WalletLedgerService } from "../../src/modules/hosts/services/wallet-ledger.service";
import { PaymentProviderRegistry } from "../../src/modules/payments/providers/payment-provider.registry";
import { PurposeHandlerRegistry } from "../../src/modules/payments/purposes/purpose-handler.registry";
import type {
  InitializeInput,
  InitializeResult,
  ParsedWebhook,
  PaymentProvider,
  VerifyResult,
} from "../../src/modules/payments/providers/payment-provider.interface";

/**
 * Drives RefundWebhookService both directly and through
 * PaymentsService.processWebhook against a real Postgres (Testcontainers).
 * Only the Monnify provider adapter is faked — everything else (DB writes,
 * the wallet-ledger hash chain, the edge-level webhook dedup) is live.
 *
 * Covers the reconciliation path opened by the `MONNIFY_USE_REFUND_API`
 * rollout flag (A4/A6 of the refund-API-rewire plan): a refund initiated
 * via `provider.refund()` lands as `refunds.status = "processing"` +
 * a `wallet_ledger` entry with `status: "pending"`; this webhook flips both
 * for real once Monnify's SUCCESSFUL_REFUND/FAILED_REFUND event arrives.
 */
class FakeRefundProvider implements PaymentProvider {
  readonly code = "monnify";

  async initialize(_input: InitializeInput): Promise<InitializeResult> {
    throw new Error("not used in this spec");
  }
  async verify(): Promise<VerifyResult> {
    throw new Error("not used in this spec");
  }
  verifyWebhookSignature(): boolean {
    return true;
  }
  parseWebhook(rawBody: Buffer): ParsedWebhook {
    const b = JSON.parse(rawBody.toString("utf8")) as {
      eventId: string;
      refundReference: string;
      status: "success" | "failed";
      failureReason?: string;
    };
    return {
      providerEventId: b.eventId,
      providerReference: b.refundReference,
      domain: "refund",
      status: b.status,
      eventName: b.status === "success" ? "SUCCESSFUL_REFUND" : "FAILED_REFUND",
      failureReason: b.failureReason,
      raw: b,
    };
  }
}

describe("refund webhook reconciliation (integration)", () => {
  const url = process.env.SUPABASE_DB_URL!;
  const client = postgres(url, { max: 5 });
  const db = drizzle(client, { schema });

  const ledger = new WalletLedgerService(db);
  const refundWebhooks = new RefundWebhookService(db, ledger);
  const provider = new FakeRefundProvider();
  const registry = new PaymentProviderRegistry([provider], db);
  const purposes = new PurposeHandlerRegistry([]);
  const service = new PaymentsService(db, registry, purposes, undefined, refundWebhooks);

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  async function seedHost(): Promise<string> {
    const [host] = await db
      .insert(hostProfiles)
      .values({
        userId: randomUUID(),
        slug: `host-${randomUUID().slice(0, 8)}`,
        displayName: "Test Host",
      })
      .returning();
    await db.insert(hostWallets).values({ hostId: host!.id, balanceKobo: 200_000 });
    return host!.id;
  }

  async function seedBooking(hostId: string, amountKobo: number): Promise<string> {
    const [booking] = await db
      .insert(bookings)
      .values({
        hostId,
        customerName: "Jane Doe",
        customerEmail: "jane@example.dev",
        amountKobo,
        status: "confirmed",
      })
      .returning();
    return booking!.id;
  }

  async function seedProcessingRefund(
    hostId: string,
    bookingId: string,
    amountKobo: number,
    monnifyReference: string,
  ): Promise<Refund> {
    const [refund] = await db
      .insert(refunds)
      .values({
        bookingId,
        hostId,
        amountKobo,
        idempotencyKey: randomUUID(),
        destinationBankCode: "044",
        destinationAccountNumber: "0123456789",
        destinationAccountName: "Jane Doe",
        monnifyReference,
        status: "processing",
      })
      .returning();

    // Optimistic debit exactly as HostBookingsService.refundBooking()'s
    // opt-in refund-API path leaves it: ledger status "pending" until this
    // webhook resolves it.
    await db.transaction(async (trx) => {
      await ledger.appendEntry({
        trx,
        hostId,
        amountKobo,
        type: "debit",
        sourceType: "refund",
        sourceMode: "refund",
        sourceId: refund!.id,
        status: "pending",
        memo: "test seed — optimistic refund debit",
      });
    });

    return refund!;
  }

  async function walletBalance(hostId: string): Promise<number> {
    const [row] = await db
      .select({ balanceKobo: hostWallets.balanceKobo })
      .from(hostWallets)
      .where(eq(hostWallets.hostId, hostId))
      .limit(1);
    return row!.balanceKobo;
  }

  async function ledgerEntryFor(refundId: string) {
    const [row] = await db
      .select()
      .from(walletLedger)
      .where(and(eq(walletLedger.sourceType, "refund"), eq(walletLedger.sourceId, refundId)))
      .limit(1);
    return row;
  }

  function webhookBody(opts: {
    eventId: string;
    refundReference: string;
    status: "success" | "failed";
    failureReason?: string;
  }): Buffer {
    return Buffer.from(JSON.stringify(opts));
  }

  describe("SUCCESSFUL_REFUND", () => {
    it("flips the refund + ledger entry to success, routed through PaymentsService.processWebhook", async () => {
      const hostId = await seedHost();
      const bookingId = await seedBooking(hostId, 20_000);
      const refundReference = `refund_${randomUUID()}`;
      const refund = await seedProcessingRefund(hostId, bookingId, 20_000, refundReference);

      const balanceAfterDebit = await walletBalance(hostId);
      expect(balanceAfterDebit).toBe(180_000);

      const eventId = `evt_${randomUUID()}`;
      const result = await service.processWebhook(
        "monnify",
        webhookBody({ eventId, refundReference, status: "success" }),
        {},
      );
      expect(result).toEqual({ handled: true });

      const [updated] = await db.select().from(refunds).where(eq(refunds.id, refund.id));
      expect(updated!.status).toBe("success");
      expect(updated!.failureReason).toBeNull();

      const ledgerRow = await ledgerEntryFor(refund.id);
      expect(ledgerRow!.status).toBe("success");

      // No compensating credit on success — balance unchanged.
      expect(await walletBalance(hostId)).toBe(180_000);
    });

    it("is idempotent against a redelivery with the same providerEventId", async () => {
      const hostId = await seedHost();
      const bookingId = await seedBooking(hostId, 10_000);
      const refundReference = `refund_${randomUUID()}`;
      const refund = await seedProcessingRefund(hostId, bookingId, 10_000, refundReference);

      const eventId = `evt_${randomUUID()}`;
      const body = webhookBody({ eventId, refundReference, status: "success" });

      const first = await service.processWebhook("monnify", body, {});
      const replay = await service.processWebhook("monnify", body, {});

      expect(first).toEqual({ handled: true });
      expect(replay).toEqual({ handled: false, reason: "duplicate" });

      const [row] = await db.select().from(refunds).where(eq(refunds.id, refund.id));
      expect(row!.status).toBe("success");
    });
  });

  describe("FAILED_REFUND", () => {
    it("flips to failed, restores the wallet balance with a compensating credit, and leaves the booking cancellation alone", async () => {
      const hostId = await seedHost();
      const bookingId = await seedBooking(hostId, 15_000);
      const refundReference = `refund_${randomUUID()}`;
      const refund = await seedProcessingRefund(hostId, bookingId, 15_000, refundReference);

      expect(await walletBalance(hostId)).toBe(185_000);

      const eventId = `evt_${randomUUID()}`;
      const result = await service.processWebhook(
        "monnify",
        webhookBody({
          eventId,
          refundReference,
          status: "failed",
          failureReason: "Insufficient balance",
        }),
        {},
      );
      expect(result).toEqual({ handled: true });

      const [updated] = await db.select().from(refunds).where(eq(refunds.id, refund.id));
      expect(updated!.status).toBe("failed");
      expect(updated!.failureReason).toBe("Insufficient balance");

      const ledgerRow = await ledgerEntryFor(refund.id);
      expect(ledgerRow!.status).toBe("failed");

      // Compensating credit restores the wallet to its pre-refund balance.
      expect(await walletBalance(hostId)).toBe(200_000);

      const creditRows = await db
        .select()
        .from(walletLedger)
        .where(
          and(eq(walletLedger.sourceType, "refund"), eq(walletLedger.sourceId, refund.id)),
        );
      expect(creditRows).toHaveLength(2);
      const credit = creditRows.find((r) => r.type === "credit");
      expect(credit).toBeTruthy();
      expect(credit!.amountKobo).toBe(15_000);
    });

    it("reconcile() is idempotent even when called directly twice (bypassing the edge-level dedup) — no double compensating credit", async () => {
      const hostId = await seedHost();
      const bookingId = await seedBooking(hostId, 8_000);
      const refundReference = `refund_${randomUUID()}`;
      const refund = await seedProcessingRefund(hostId, bookingId, 8_000, refundReference);

      const parsed: ParsedWebhook = {
        providerEventId: `evt_${randomUUID()}`,
        providerReference: refundReference,
        domain: "refund",
        status: "failed",
        eventName: "FAILED_REFUND",
        failureReason: "Account name mismatch",
        raw: {},
      };

      const first = await refundWebhooks.reconcile(parsed);
      const second = await refundWebhooks.reconcile(parsed);

      expect(first).toEqual({ handled: true });
      expect(second).toEqual({ handled: true });

      expect(await walletBalance(hostId)).toBe(200_000);
      const creditRows = await db
        .select()
        .from(walletLedger)
        .where(
          and(
            eq(walletLedger.sourceType, "refund"),
            eq(walletLedger.sourceId, refund.id),
            eq(walletLedger.type, "credit"),
          ),
        );
      expect(creditRows).toHaveLength(1);
    });
  });

  describe("unmatched refund reference", () => {
    it("returns handled: false without throwing", async () => {
      const result = await service.processWebhook(
        "monnify",
        webhookBody({
          eventId: `evt_${randomUUID()}`,
          refundReference: `refund_${randomUUID()}`,
          status: "success",
        }),
        {},
      );
      expect(result.handled).toBe(false);
      expect(result.reason).toBe("refund not found for provider reference");
    });
  });
});
