import { randomUUID, createHash } from "node:crypto";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { and, eq } from "drizzle-orm";
import type { ConfigService } from "@nestjs/config";
import * as schema from "../../src/drizzle/schema";
import {
  hostProfiles,
  hostWallets,
  paycodes,
  securityChallenges,
  walletLedger,
} from "../../src/drizzle/schema";
import { PaycodeService } from "../../src/modules/hosts/services/paycode.service";
import { WalletLedgerService } from "../../src/modules/hosts/services/wallet-ledger.service";
import { SecurityService } from "../../src/modules/security/security.service";
import { PaymentProviderRegistry } from "../../src/modules/payments/providers/payment-provider.registry";

/**
 * Drives PaycodeService's create → cancel and create → expire-sweep flows
 * against a real Postgres (Testcontainers) — the `pending`-debit →
 * compensating-credit pattern this exercises has no unit-test coverage
 * (it needs a real `db.transaction` + advisory lock), same gap
 * `refund-webhook.int-spec.ts` fills for the refund path.
 *
 * Runs entirely in mock mode (`MONNIFY_USE_PAYCODE_API` off) — the
 * provider-call-building pieces are covered by
 * `paycode.service.spec.ts`/`monnify.provider.spec.ts` instead. Only the
 * emails dependency is faked (no real BullMQ/Redis needed); everything
 * else (DB writes, the wallet-ledger hash chain, OTP challenges) is live.
 */
const OTP_CODE = "123456";
const noopEmails = { enqueue: async () => undefined } as unknown as ConstructorParameters<
  typeof SecurityService
>[1];

function fakeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = {
    "monnify.usePaycodeApi": false,
    "monnify.paycodeExpiryHours": 24,
    ...overrides,
  };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

describe("PaycodeService — create/cancel/expiry (integration)", () => {
  const url = process.env.SUPABASE_DB_URL!;
  const client = postgres(url, { max: 5 });
  const db = drizzle(client, { schema });

  const ledger = new WalletLedgerService(db);
  const security = new SecurityService(db, noopEmails);
  // Mock mode never calls the provider — an empty registry is fine.
  const registry = new PaymentProviderRegistry([], db);
  const service = new PaycodeService(db, registry, security, ledger, fakeConfig());

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

  async function seedOtp(userId: string, purpose: "create_paycode" | "reveal_paycode"): Promise<void> {
    const codeHash = createHash("sha256").update(OTP_CODE).digest("hex");
    await db.insert(securityChallenges).values({
      userId,
      purpose,
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

  async function ledgerEntriesFor(paycodeId: string) {
    return db
      .select()
      .from(walletLedger)
      .where(and(eq(walletLedger.sourceType, "paycode"), eq(walletLedger.sourceId, paycodeId)));
  }

  it("debits the wallet and creates a pending paycode + pending ledger entry", async () => {
    const { userId, hostId } = await seedHost();
    await seedOtp(userId, "create_paycode");

    const { paycode, cached } = await service.createPaycode(userId, {
      amountKobo: 50_000,
      idempotencyKey: randomUUID(),
      otpCode: OTP_CODE,
    });

    expect(cached).toBe(false);
    expect(paycode.status).toBe("pending");
    expect(paycode.maskedPaycode).toBeTruthy();
    expect(await walletBalance(hostId)).toBe(150_000);

    const entries = await ledgerEntriesFor(paycode.id);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.type).toBe("debit");
    expect(entries[0]!.status).toBe("pending");

    const chain = await ledger.verifyChain(hostId);
    expect(chain.ok).toBe(true);
  });

  it("returns the cached row on a retried idempotency key without a second debit", async () => {
    const { userId, hostId } = await seedHost();
    await seedOtp(userId, "create_paycode");
    const idempotencyKey = randomUUID();

    const first = await service.createPaycode(userId, {
      amountKobo: 20_000,
      idempotencyKey,
      otpCode: OTP_CODE,
    });
    expect(first.cached).toBe(false);
    expect(await walletBalance(hostId)).toBe(180_000);

    // Retried request with the SAME idempotency key — no OTP challenge left
    // this time, proving the cached path never re-consumes one.
    const second = await service.createPaycode(userId, {
      amountKobo: 20_000,
      idempotencyKey,
      otpCode: OTP_CODE,
    });
    expect(second.cached).toBe(true);
    expect(second.paycode.id).toBe(first.paycode.id);
    expect(await walletBalance(hostId)).toBe(180_000);
  });

  it("cancelPaycode credits the hold back and flips the ledger entry to cancelled", async () => {
    const { userId, hostId } = await seedHost();
    await seedOtp(userId, "create_paycode");
    const { paycode } = await service.createPaycode(userId, {
      amountKobo: 30_000,
      idempotencyKey: randomUUID(),
      otpCode: OTP_CODE,
    });
    expect(await walletBalance(hostId)).toBe(170_000);

    const cancelled = await service.cancelPaycode(userId, paycode.id);
    expect(cancelled.status).toBe("cancelled");

    // Compensating credit restores the wallet to its pre-create balance.
    expect(await walletBalance(hostId)).toBe(200_000);

    const entries = await ledgerEntriesFor(paycode.id);
    expect(entries).toHaveLength(2);
    expect(entries.find((e) => e.type === "debit")!.status).toBe("cancelled");
    const credit = entries.find((e) => e.type === "credit");
    expect(credit).toBeTruthy();
    expect(credit!.amountKobo).toBe(30_000);

    const chain = await ledger.verifyChain(hostId);
    expect(chain.ok).toBe(true);
  });

  it("rejects cancelling a paycode that isn't pending", async () => {
    const { userId } = await seedHost();
    await seedOtp(userId, "create_paycode");
    const { paycode } = await service.createPaycode(userId, {
      amountKobo: 10_000,
      idempotencyKey: randomUUID(),
      otpCode: OTP_CODE,
    });
    await service.cancelPaycode(userId, paycode.id);

    await expect(service.cancelPaycode(userId, paycode.id)).rejects.toThrow(
      /Cannot cancel a paycode/,
    );
  });

  it("reconcileAllExpiredPaycodes expires a stale pending paycode and credits the wallet back", async () => {
    const { userId, hostId } = await seedHost();
    await seedOtp(userId, "create_paycode");
    const { paycode } = await service.createPaycode(userId, {
      amountKobo: 40_000,
      idempotencyKey: randomUUID(),
      otpCode: OTP_CODE,
    });
    expect(await walletBalance(hostId)).toBe(160_000);

    // Force it into the past — same effect as the 5-minute sweep finding a
    // genuinely unredeemed code well past its expiry.
    await db
      .update(paycodes)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(paycodes.id, paycode.id));

    const reconciled = await service.reconcileAllExpiredPaycodes();
    expect(reconciled).toBeGreaterThanOrEqual(1);

    const [updated] = await db.select().from(paycodes).where(eq(paycodes.id, paycode.id));
    expect(updated!.status).toBe("expired");
    expect(await walletBalance(hostId)).toBe(200_000);

    const entries = await ledgerEntriesFor(paycode.id);
    expect(entries.find((e) => e.type === "debit")!.status).toBe("failed");
    expect(entries.find((e) => e.type === "credit")).toBeTruthy();
  });

  it("is idempotent against a repeated sweep — no double compensating credit", async () => {
    const { userId, hostId } = await seedHost();
    await seedOtp(userId, "create_paycode");
    const { paycode } = await service.createPaycode(userId, {
      amountKobo: 15_000,
      idempotencyKey: randomUUID(),
      otpCode: OTP_CODE,
    });
    await db
      .update(paycodes)
      .set({ expiresAt: new Date(Date.now() - 60_000) })
      .where(eq(paycodes.id, paycode.id));

    await service.reconcileAllExpiredPaycodes();
    await service.reconcileAllExpiredPaycodes();

    expect(await walletBalance(hostId)).toBe(200_000);
    const entries = await ledgerEntriesFor(paycode.id);
    expect(entries.filter((e) => e.type === "credit")).toHaveLength(1);
  });

  it("revealPaycode returns a deterministic mock code, gated by its own OTP purpose", async () => {
    const { userId } = await seedHost();
    await seedOtp(userId, "create_paycode");
    const { paycode } = await service.createPaycode(userId, {
      amountKobo: 25_000,
      idempotencyKey: randomUUID(),
      otpCode: OTP_CODE,
    });

    await seedOtp(userId, "reveal_paycode");
    const revealed = await service.revealPaycode(userId, paycode.id, OTP_CODE);
    expect(revealed.clearPaycode).toMatch(/^\d{8}$/);

    // Deterministic — a second reveal (fresh OTP) returns the same code.
    await seedOtp(userId, "reveal_paycode");
    const revealedAgain = await service.revealPaycode(userId, paycode.id, OTP_CODE);
    expect(revealedAgain.clearPaycode).toBe(revealed.clearPaycode);
  });

  it("rejects revealing without a reveal_paycode OTP even if create_paycode's was used", async () => {
    const { userId } = await seedHost();
    await seedOtp(userId, "create_paycode");
    const { paycode } = await service.createPaycode(userId, {
      amountKobo: 5_000,
      idempotencyKey: randomUUID(),
      otpCode: OTP_CODE,
    });

    // No reveal_paycode challenge seeded — must be rejected.
    await expect(service.revealPaycode(userId, paycode.id, OTP_CODE)).rejects.toThrow();
  });
});
