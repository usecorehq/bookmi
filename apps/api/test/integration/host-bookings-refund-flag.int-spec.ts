import { randomUUID, createHash } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import type { ConfigService } from "@nestjs/config";
import * as schema from "../../src/drizzle/schema";
import {
  bookings,
  hostProfiles,
  hostWallets,
  paymentTransactions,
  refunds,
  securityChallenges,
  walletLedger,
  type Booking,
} from "../../src/drizzle/schema";
import { HostBookingsService } from "../../src/modules/hosts/services/host-bookings.service";
import { WalletLedgerService } from "../../src/modules/hosts/services/wallet-ledger.service";
import { SecurityService } from "../../src/modules/security/security.service";
import { PaymentProviderRegistry } from "../../src/modules/payments/providers/payment-provider.registry";
import type {
  Bank,
  DisburseInput,
  DisburseResult,
  InitializeInput,
  InitializeResult,
  ParsedWebhook,
  PaymentProvider,
  RefundInput,
  RefundResult,
  VerifyResult,
} from "../../src/modules/payments/providers/payment-provider.interface";

/**
 * Drives HostBookingsService.refundBooking() against a real Postgres
 * (Testcontainers). Only the Monnify provider adapter is faked — DB writes,
 * advisory locks, the OTP gate, and the wallet-ledger hash chain are all
 * live.
 *
 * The whole point of this spec: confirm the `MONNIFY_USE_REFUND_API`
 * rollout flag (A5/A6 of the refund-API-rewire plan) defaults to `false`
 * and, when unset/false, produces EXACTLY today's disburse()-based
 * behavior — a hard regression guard against the "no breaking changes"
 * requirement — while also covering the new opt-in path (including its
 * JIT provider_transaction_id backfill) when the flag is explicitly on.
 */
class FakeMonnifyProvider implements PaymentProvider {
  readonly code = "monnify";
  disburseCalls: DisburseInput[] = [];
  refundCalls: RefundInput[] = [];
  verifyCalls: string[] = [];
  verifyResult: VerifyResult | null = null;
  nextRefundResult: RefundResult = { providerReference: "mnfy_refund_x", status: "processing" };

  async initialize(_input: InitializeInput): Promise<InitializeResult> {
    throw new Error("not used in this spec");
  }
  async verify(providerReference: string): Promise<VerifyResult> {
    this.verifyCalls.push(providerReference);
    if (!this.verifyResult) throw new Error("test forgot to set verifyResult");
    return this.verifyResult;
  }
  verifyWebhookSignature(): boolean {
    return true;
  }
  parseWebhook(): ParsedWebhook {
    throw new Error("not used in this spec");
  }
  async listBanks(): Promise<Bank[]> {
    return [];
  }
  async resolveBankAccount(): Promise<{ accountName: string; bankName: string }> {
    return { accountName: "Jane Doe", bankName: "Test Bank" };
  }
  async disburse(input: DisburseInput): Promise<DisburseResult> {
    this.disburseCalls.push(input);
    return { providerReference: `mnfy_disb_${input.reference}`, status: "success" };
  }
  async refund(input: RefundInput): Promise<RefundResult> {
    this.refundCalls.push(input);
    return { ...this.nextRefundResult, providerReference: `mnfy_refund_${input.refundReference}` };
  }
}

function fakeConfig(useRefundApi: boolean | undefined): ConfigService {
  return {
    get: (key: string) => (key === "monnify.useRefundApi" ? useRefundApi : undefined),
  } as unknown as ConfigService;
}

const OTP_CODE = "123456";
const noopEmails = { enqueue: async () => undefined } as unknown as ConstructorParameters<
  typeof SecurityService
>[1];

describe("HostBookingsService.refundBooking() — rollout flag (integration)", () => {
  const url = process.env.SUPABASE_DB_URL!;
  const client = postgres(url, { max: 5 });
  const db = drizzle(client, { schema });

  const ledger = new WalletLedgerService(db);
  const security = new SecurityService(db, noopEmails);

  afterAll(async () => {
    await client.end({ timeout: 5 });
  });

  async function seedHost(): Promise<{ userId: string; hostId: string }> {
    const userId = randomUUID();
    const [host] = await db
      .insert(hostProfiles)
      .values({
        userId,
        slug: `host-${randomUUID().slice(0, 8)}`,
        displayName: "Test Host",
      })
      .returning();
    await db.insert(hostWallets).values({ hostId: host!.id, balanceKobo: 200_000 });
    return { userId, hostId: host!.id };
  }

  async function seedBooking(
    hostId: string,
    amountKobo: number,
    paymentTransactionId?: string,
  ): Promise<Booking> {
    const [booking] = await db
      .insert(bookings)
      .values({
        hostId,
        customerName: "Jane Doe",
        customerEmail: "jane@example.dev",
        amountKobo,
        status: "confirmed",
        paymentTransactionId: paymentTransactionId ?? null,
      })
      .returning();
    return booking!;
  }

  async function seedPaymentTransaction(opts: {
    providerReference: string;
    providerTransactionId: string | null;
    amountMinor: number;
  }): Promise<string> {
    const [tx] = await db
      .insert(paymentTransactions)
      .values({
        reference: `bookmi_pmt_${randomUUID()}`,
        providerCode: "monnify",
        providerReference: opts.providerReference,
        providerTransactionId: opts.providerTransactionId,
        status: "success",
        amountMinor: opts.amountMinor,
        currency: "NGN",
        countryCode: "NG",
        purposeType: "booking_checkout",
        initiatorUserId: randomUUID(),
        payerEmail: "jane@example.dev",
      })
      .returning();
    return tx!.id;
  }

  async function seedOtp(userId: string): Promise<void> {
    const codeHash = createHash("sha256").update(OTP_CODE).digest("hex");
    await db.insert(securityChallenges).values({
      userId,
      purpose: "refund_booking",
      codeHash,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });
  }

  async function walletBalance(hostId: string): Promise<number> {
    const [row] = await db
      .select({ balanceKobo: hostWallets.balanceKobo })
      .from(hostWallets)
      .where(eq(hostWallets.hostId, hostId))
      .limit(1);
    return row!.balanceKobo;
  }

  function makeService(useRefundApi: boolean | undefined, provider: FakeMonnifyProvider) {
    const registry = new PaymentProviderRegistry([provider], db);
    return new HostBookingsService(
      db,
      noopEmails as unknown as ConstructorParameters<typeof HostBookingsService>[1],
      fakeConfig(useRefundApi),
      registry,
      security,
      ledger,
    );
  }

  describe("flag unset/false — default path", () => {
    it("calls disburse() exactly as today: refund + ledger status 'success', booking canceled", async () => {
      const { userId, hostId } = await seedHost();
      const booking = await seedBooking(hostId, 20_000);
      await seedOtp(userId);

      const provider = new FakeMonnifyProvider();
      const service = makeService(undefined, provider); // unset → defaults false

      const result = await service.refundBooking(userId, booking.id, {
        bankCode: "044",
        accountNumber: "0123456789",
        accountName: "Jane Doe",
        amountKobo: 20_000,
        idempotencyKey: randomUUID(),
        otpCode: OTP_CODE,
      });

      expect(provider.disburseCalls).toHaveLength(1);
      expect(provider.refundCalls).toHaveLength(0);
      expect(result.refund.status).toBe("success");
      expect(result.booking?.status).toBe("canceled");
      expect(result.booking?.refundedAmountKobo).toBe(20_000);

      const [ledgerRow] = await db
        .select()
        .from(walletLedger)
        .where(eq(walletLedger.sourceId, result.refund.id));
      expect(ledgerRow!.status).toBe("success");
      expect(await walletBalance(hostId)).toBe(180_000);
    });
  });

  describe("flag true — opt-in refund-API path", () => {
    it("calls refund() with the original transaction's providerTransactionId; processing maps to refunds.status 'processing' / ledger 'pending'", async () => {
      const { userId, hostId } = await seedHost();
      const txId = await seedPaymentTransaction({
        providerReference: "bookmi-ref-1",
        providerTransactionId: "MNFY|TX|1",
        amountMinor: 20_000,
      });
      const booking = await seedBooking(hostId, 20_000, txId);
      await seedOtp(userId);

      const provider = new FakeMonnifyProvider();
      provider.nextRefundResult = { providerReference: "mnfy_refund_x", status: "processing" };
      const service = makeService(true, provider);

      const result = await service.refundBooking(userId, booking.id, {
        bankCode: "044",
        accountNumber: "0123456789",
        accountName: "Jane Doe",
        amountKobo: 20_000,
        idempotencyKey: randomUUID(),
        otpCode: OTP_CODE,
      });

      expect(provider.disburseCalls).toHaveLength(0);
      expect(provider.refundCalls).toHaveLength(1);
      expect(provider.refundCalls[0]?.transactionReference).toBe("MNFY|TX|1");
      expect(provider.verifyCalls).toHaveLength(0); // already had providerTransactionId — no JIT backfill needed

      expect(result.refund.status).toBe("processing");
      expect(result.booking?.status).toBe("canceled");

      const [ledgerRow] = await db
        .select()
        .from(walletLedger)
        .where(eq(walletLedger.sourceId, result.refund.id));
      expect(ledgerRow!.status).toBe("pending");
    });

    it("JIT-backfills provider_transaction_id via a live verify() call for a legacy row missing it", async () => {
      const { userId, hostId } = await seedHost();
      const txId = await seedPaymentTransaction({
        providerReference: "bookmi-ref-legacy",
        providerTransactionId: null, // pre-A2 row
        amountMinor: 12_000,
      });
      const booking = await seedBooking(hostId, 12_000, txId);
      await seedOtp(userId);

      const provider = new FakeMonnifyProvider();
      provider.verifyResult = {
        status: "success",
        providerReference: "bookmi-ref-legacy",
        providerTransactionId: "MNFY|TX|LEGACY",
        amountMinor: 12_000,
        currency: "NGN",
        raw: {},
      };
      provider.nextRefundResult = { providerReference: "mnfy_refund_legacy", status: "success" };
      const service = makeService(true, provider);

      const result = await service.refundBooking(userId, booking.id, {
        bankCode: "044",
        accountNumber: "0123456789",
        accountName: "Jane Doe",
        amountKobo: 12_000,
        idempotencyKey: randomUUID(),
        otpCode: OTP_CODE,
      });

      expect(provider.verifyCalls).toEqual(["bookmi-ref-legacy"]);
      expect(provider.refundCalls[0]?.transactionReference).toBe("MNFY|TX|LEGACY");
      expect(result.refund.status).toBe("success");

      const [txRow] = await db
        .select()
        .from(paymentTransactions)
        .where(eq(paymentTransactions.id, txId));
      expect(txRow!.providerTransactionId).toBe("MNFY|TX|LEGACY");
    });
  });

  describe("idempotency key reused with different request details", () => {
    it("rejects a same-key retry at a different amount instead of surfacing the first attempt's stale failure reason", async () => {
      // Reproduces a real production bug: host requests a refund larger
      // than the wallet balance, the balance check fails and marks the
      // refunds row `failed` (idempotency key stays claimed by design —
      // see the class doc comment on refundBooking). Host then corrects the
      // amount downward and resubmits under the SAME key (the frontend
      // reused it across "Change details" navigation). Before this fix,
      // the insert-first cache-hit path silently returned the ORIGINAL
      // failed row — surfacing "wallet balance below refund amount" even
      // though the NEW, lower amount was well within balance.
      const { userId, hostId } = await seedHost(); // balanceKobo: 200_000
      const booking = await seedBooking(hostId, 250_000);
      await seedOtp(userId);
      const key = randomUUID();

      const provider = new FakeMonnifyProvider();
      const service = makeService(undefined, provider);

      // First attempt: 250,000 > wallet balance (200,000) — fails the
      // in-transaction balance check, claim row marked `failed`.
      await expect(
        service.refundBooking(userId, booking.id, {
          bankCode: "044",
          accountNumber: "0123456789",
          accountName: "Jane Doe",
          amountKobo: 250_000,
          idempotencyKey: key,
          otpCode: OTP_CODE,
        }),
      ).rejects.toThrow(/wallet balance/i);

      await seedOtp(userId); // fresh OTP for the second attempt

      // Second attempt: corrected to 20,000 (well within balance), SAME
      // idempotency key. Must NOT silently return the stale failed row —
      // must reject clearly instead, telling the caller to use a fresh key.
      await expect(
        service.refundBooking(userId, booking.id, {
          bankCode: "044",
          accountNumber: "0123456789",
          accountName: "Jane Doe",
          amountKobo: 20_000,
          idempotencyKey: key,
          otpCode: OTP_CODE,
        }),
      ).rejects.toThrow(/different refund amount or destination/i);

      // No disbursement ever happened for the corrected amount, and the
      // wallet is untouched — the bug's failure mode (or a naive fix) could
      // otherwise have let this through as a false success.
      expect(provider.disburseCalls).toHaveLength(0);
      expect(await walletBalance(hostId)).toBe(200_000);
    });

    it("still hits the cache and succeeds on an identical-parameters retry (legitimate double-submit)", async () => {
      const { userId, hostId } = await seedHost();
      const booking = await seedBooking(hostId, 20_000);
      await seedOtp(userId);
      const key = randomUUID();

      const provider = new FakeMonnifyProvider();
      const service = makeService(undefined, provider);

      const input = {
        bankCode: "044",
        accountNumber: "0123456789",
        accountName: "Jane Doe",
        amountKobo: 20_000,
        idempotencyKey: key,
        otpCode: OTP_CODE,
      };

      const first = await service.refundBooking(userId, booking.id, input);
      expect(first.cached).toBe(false);
      expect(first.refund.status).toBe("success");

      // Identical retry, same key — must hit the cache path and return the
      // same row, not throw the mismatch error (params are unchanged).
      const second = await service.refundBooking(userId, booking.id, input);
      expect(second.cached).toBe(true);
      expect(second.refund.id).toBe(first.refund.id);

      // Only one disbursement ever happened.
      expect(provider.disburseCalls).toHaveLength(1);
      expect(await walletBalance(hostId)).toBe(180_000);
    });
  });
});
