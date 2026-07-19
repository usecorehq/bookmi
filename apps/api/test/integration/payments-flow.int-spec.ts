import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import * as schema from "../../src/drizzle/schema";
import {
  countries,
  countryPaymentProviders,
  paymentEvents,
  paymentProviders,
  paymentTransactions,
  type PaymentTransaction,
} from "../../src/drizzle/schema";
import { PaymentsService } from "../../src/modules/payments/services/payments.service";
import { PaymentProviderRegistry } from "../../src/modules/payments/providers/payment-provider.registry";
import { PurposeHandlerRegistry } from "../../src/modules/payments/purposes/purpose-handler.registry";
import type {
  InitializeInput,
  InitializeResult,
  NormalizedStatus,
  ParsedWebhook,
  PaymentProvider,
  VerifyResult,
} from "../../src/modules/payments/providers/payment-provider.interface";
import type { PaymentPurposeHandler } from "../../src/modules/payments/purposes/purpose-handler.interface";

/**
 * Drives the real PaymentsService against a real Postgres (Testcontainers).
 * Only the provider is faked — DB writes, advisory locks, unique indexes,
 * the state machine, and the purpose handler dispatch are all live.
 *
 * The booking_checkout handler is heavier (needs pre-seeded hosts +
 * services + wallets); this spec exercises the orchestrator with a
 * recording purpose so the state-machine semantics are isolated from
 * domain wiring. A follow-up booking-checkout.int-spec.ts covers the
 * host+wallet ledger.
 */

class FakeProvider implements PaymentProvider {
  readonly code = "monnify";
  initializeCalls = 0;
  failNextInitialize = false;
  verifyResult: VerifyResult | null = null;

  async initialize(input: InitializeInput): Promise<InitializeResult> {
    this.initializeCalls += 1;
    if (this.failNextInitialize) {
      this.failNextInitialize = false;
      throw new Error("provider down");
    }
    return {
      providerReference: input.reference,
      accessCode: `AC_${input.reference}`,
      authorizationUrl: `https://checkout.fake/${input.reference}`,
      raw: { fake: true },
    };
  }

  async verify(providerReference: string): Promise<VerifyResult> {
    if (!this.verifyResult) throw new Error("test forgot to set verifyResult");
    return { ...this.verifyResult, providerReference };
  }

  verifyWebhookSignature(): boolean {
    return true;
  }

  parseWebhook(rawBody: Buffer): ParsedWebhook {
    const b = JSON.parse(rawBody.toString("utf8")) as {
      eventId: string;
      reference: string;
      status: NormalizedStatus;
      amountMinor?: number;
      currency?: string;
    };
    return {
      providerEventId: b.eventId,
      providerReference: b.reference,
      status: b.status,
      eventName: `fake.${b.status}`,
      amountMinor: b.amountMinor,
      currency: b.currency,
      raw: b,
    };
  }
}

class RecordingHandler implements PaymentPurposeHandler {
  readonly purposeType = "recording_test";
  successes: string[] = [];
  failures: string[] = [];
  async onSuccess(tx: PaymentTransaction): Promise<void> {
    this.successes.push(tx.reference);
  }
  async onFailure(tx: PaymentTransaction): Promise<void> {
    this.failures.push(tx.reference);
  }
}

describe("payments flow (integration)", () => {
  const url = process.env.SUPABASE_DB_URL!;
  const client = postgres(url, { max: 5 });
  const db = drizzle(client, { schema });

  const provider = new FakeProvider();
  const handler = new RecordingHandler();
  // Simulate the DI wiring: registry constructors take pre-instantiated arrays.
  const registry = new PaymentProviderRegistry([provider], db);
  const purposes = new PurposeHandlerRegistry([handler]);
  const service = new PaymentsService(db, registry, purposes);

  const userId = randomUUID();

  const baseInput = () => ({
    purposeType: "recording_test",
    amountMinor: 5_000,
    currency: "NGN",
    email: "payer@test.dev",
    initiatorUserId: userId,
  });

  async function rowByReference(reference: string): Promise<PaymentTransaction> {
    const [row] = await db
      .select()
      .from(paymentTransactions)
      .where(eq(paymentTransactions.reference, reference))
      .limit(1);
    if (!row) throw new Error(`row ${reference} missing`);
    return row;
  }

  async function statusChangedEvents(txId: string) {
    return db
      .select()
      .from(paymentEvents)
      .where(
        and(
          eq(paymentEvents.transactionId, txId),
          eq(paymentEvents.eventType, "status_changed"),
        ),
      );
  }

  beforeAll(async () => {
    await db
      .insert(countries)
      .values({ code: "NG", name: "Nigeria", defaultCurrency: "NGN" })
      .onConflictDoNothing();
    await db
      .insert(paymentProviders)
      .values({ code: "monnify", name: "Monnify" })
      .onConflictDoNothing();
    await db
      .insert(countryPaymentProviders)
      .values({ countryCode: "NG", providerCode: "monnify", priority: 0 })
      .onConflictDoNothing();
  });

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  describe("initiate + idempotency", () => {
    it("creates a transaction and returns the provider checkout config", async () => {
      const result = await service.initiate(baseInput());

      expect(result.reference).toMatch(/^bookmi_pmt_|-bookmi_pmt_/);
      expect(result.accessCode).toBe(`AC_${result.reference}`);
      expect(result.status).toBe("pending");

      const row = await rowByReference(result.reference);
      expect(row.providerReference).toBe(result.reference);
      expect(row.accessCode).toBe(result.accessCode);
      expect(row.amountMinor).toBe(5_000);
    });

    it("replays the same idempotency key without a second provider call", async () => {
      const key = randomUUID();
      const callsBefore = provider.initializeCalls;

      const first = await service.initiate({ ...baseInput(), idempotencyKey: key });
      const replay = await service.initiate({ ...baseInput(), idempotencyKey: key });

      expect(replay.reference).toBe(first.reference);
      expect(replay.accessCode).toBe(first.accessCode);
      expect(provider.initializeCalls).toBe(callsBefore + 1);
    });

    it("collapses concurrent initiates with the same key onto one transaction", async () => {
      const key = randomUUID();
      const [a, b] = await Promise.all([
        service.initiate({ ...baseInput(), idempotencyKey: key }),
        service.initiate({ ...baseInput(), idempotencyKey: key }),
      ]);

      expect(a.reference).toBe(b.reference);
      const rows = await db
        .select()
        .from(paymentTransactions)
        .where(
          and(
            eq(paymentTransactions.initiatorUserId, userId),
            eq(paymentTransactions.idempotencyKey, key),
          ),
        );
      expect(rows).toHaveLength(1);
    });

    it("retries the provider call on replay when the first attempt failed", async () => {
      const key = randomUUID();
      provider.failNextInitialize = true;

      await expect(
        service.initiate({ ...baseInput(), idempotencyKey: key }),
      ).rejects.toThrow("provider down");

      const [stuck] = await db
        .select()
        .from(paymentTransactions)
        .where(
          and(
            eq(paymentTransactions.initiatorUserId, userId),
            eq(paymentTransactions.idempotencyKey, key),
          ),
        );
      expect(stuck!.status).toBe("pending");
      expect(stuck!.providerReference).toBeNull();

      const retry = await service.initiate({ ...baseInput(), idempotencyKey: key });
      expect(retry.reference).toBe(stuck!.reference);
      expect(retry.accessCode).toBe(`AC_${stuck!.reference}`);
    });
  });

  describe("verify + webhook + finalize", () => {
    it("verify settles a pending tx and fires the purpose handler exactly once", async () => {
      const init = await service.initiate(baseInput());
      const tx = await rowByReference(init.reference);

      provider.verifyResult = {
        status: "success",
        providerReference: init.reference,
        amountMinor: 5_000,
        currency: "NGN",
        raw: {},
      };

      handler.successes = [];
      await service.verify(init.reference);

      const settled = await rowByReference(init.reference);
      expect(settled.status).toBe("success");
      expect(settled.completedAt).not.toBeNull();
      expect(handler.successes).toEqual([init.reference]);

      const events = await statusChangedEvents(tx.id);
      expect(events).toHaveLength(1);
      expect(events[0]?.toStatus).toBe("success");

      // Idempotency: a second verify is a no-op — no additional event, handler
      // does not fire again.
      handler.successes = [];
      await service.verify(init.reference);
      expect(handler.successes).toEqual([]);
      const eventsAfter = await statusChangedEvents(tx.id);
      expect(eventsAfter).toHaveLength(1);
    });

    it("webhook processing dedupes on (providerCode, providerEventId)", async () => {
      const init = await service.initiate(baseInput());
      const eventId = `evt_${init.reference}`;

      const rawBody = Buffer.from(
        JSON.stringify({
          eventId,
          reference: init.reference,
          status: "success" satisfies NormalizedStatus,
          amountMinor: 5_000,
          currency: "NGN",
        }),
      );

      handler.successes = [];
      const first = await service.processWebhook("monnify", rawBody, {});
      const second = await service.processWebhook("monnify", rawBody, {});

      expect(first).toEqual({ handled: true });
      expect(second).toEqual({ handled: false, reason: "duplicate" });
      // Handler fires exactly once across the two identical webhook attempts.
      expect(handler.successes).toEqual([init.reference]);

      const settled = await rowByReference(init.reference);
      expect(settled.status).toBe("success");
    });

    it("refuses to settle success on amount mismatch — tx stays pending, error event logged", async () => {
      const init = await service.initiate(baseInput());
      const tx = await rowByReference(init.reference);

      // Provider reports success but with the wrong amount.
      provider.verifyResult = {
        status: "success",
        providerReference: init.reference,
        amountMinor: 3_000,
        currency: "NGN",
        raw: {},
      };

      handler.successes = [];
      await service.verify(init.reference);

      const stillPending = await rowByReference(init.reference);
      expect(stillPending.status).toBe("pending");
      expect(handler.successes).toEqual([]);

      const errors = await db
        .select()
        .from(paymentEvents)
        .where(and(eq(paymentEvents.transactionId, tx.id), eq(paymentEvents.eventType, "error")));
      const amountMismatchEvent = errors.find(
        (e) => (e.payload as { reason?: string }).reason === "amount_mismatch",
      );
      expect(amountMismatchEvent).toBeTruthy();
    });
  });
});
