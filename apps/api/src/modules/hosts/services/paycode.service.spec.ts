import { ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { SupabaseDb } from "../../../drizzle/drizzle.module";
import { PaycodeService } from "./paycode.service";
import type { PaymentProviderRegistry } from "../../payments/providers/payment-provider.registry";
import type { SecurityService } from "../../security/security.service";
import type { WalletLedgerService } from "./wallet-ledger.service";

/**
 * These tests exercise `createRealPaycode` (private — accessed via bracket
 * notation) in isolation: it only touches `registry`, never `db`, so the
 * other constructor deps can be dummy stubs. Same scope discipline as
 * `host-wallet.service.spec.ts`'s `reserveRealAccount` tests — the full
 * transactional create/cancel/expire flow (advisory lock, ledger writes)
 * needs a real Postgres and is covered by the integration spec instead.
 */
function fakeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = { ...overrides };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function buildService(createPaycode: jest.Mock | undefined, config: ConfigService = fakeConfig()) {
  const registry = {
    get: () => (createPaycode ? { createPaycode } : {}),
  } as unknown as PaymentProviderRegistry;

  return new PaycodeService(
    {} as unknown as SupabaseDb,
    registry,
    {} as unknown as SecurityService,
    {} as unknown as WalletLedgerService,
    config,
  );
}

describe("PaycodeService.createRealPaycode", () => {
  it("calls provider.createPaycode with the expected input and returns its result", async () => {
    const expiresAt = new Date("2026-08-01T00:00:00.000Z");
    const createPaycode = jest.fn().mockResolvedValue({
      paycodeReference: "pc_1",
      transactionReference: "MFY-PC-1",
      beneficiaryName: "Ada Bookings",
      amountMinor: 50_000,
      feeMinor: 1_000,
      status: "pending",
      maskedPaycode: "114••••09",
      raw: {},
    });
    const service = buildService(createPaycode);

    const result = await (service as any).createRealPaycode({
      paycodeReference: "pc_1",
      beneficiaryName: "Ada Bookings",
      amountMinor: 50_000,
      expiresAt,
    });

    expect(createPaycode).toHaveBeenCalledWith({
      paycodeReference: "pc_1",
      beneficiaryName: "Ada Bookings",
      amountMinor: 50_000,
      expiresAt,
    });
    expect(result.maskedPaycode).toBe("114••••09");
    expect(result.status).toBe("pending");
  });

  it("throws ServiceUnavailableException when the provider doesn't support createPaycode", async () => {
    const service = buildService(undefined);
    await expect(
      (service as any).createRealPaycode({
        paycodeReference: "pc_2",
        beneficiaryName: "B",
        amountMinor: 10_000,
        expiresAt: new Date(),
      }),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
