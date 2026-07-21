import { BadRequestException, ServiceUnavailableException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { SupabaseDb } from "../../../drizzle/drizzle.module";
import { HostWalletService } from "./host-wallet.service";
import type { PaymentProviderRegistry } from "../../payments/providers/payment-provider.registry";
import type { SecurityService } from "../../security/security.service";
import type { WalletLedgerService } from "./wallet-ledger.service";

/**
 * These tests exercise `reserveRealAccount` (private — accessed via bracket
 * notation, since TS privacy is compile-time only) in isolation: it only
 * touches `registry`/`config`, never `db`, so the other constructor deps can
 * be dummy stubs. Covers the multi-bank fallback logic this change added —
 * keeping every account Monnify returns (not just `accounts[0]`) and the
 * `reservedAccountName` fallback chain.
 */
function fakeConfig(overrides: Record<string, unknown> = {}): ConfigService {
  const values: Record<string, unknown> = { ...overrides };
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function buildService(reserveAccount: jest.Mock, config: ConfigService = fakeConfig()) {
  const registry = {
    get: () => ({ reserveAccount }),
  } as unknown as PaymentProviderRegistry;

  return new HostWalletService(
    {} as unknown as SupabaseDb,
    registry,
    {} as unknown as SecurityService,
    {} as unknown as WalletLedgerService,
    config,
  );
}

describe("HostWalletService.reserveRealAccount", () => {
  it("keeps every bank account Monnify returns, not just the first", async () => {
    const reserveAccount = jest.fn().mockResolvedValue({
      accountReference: "host-1",
      accountName: "Ada Bookings",
      accounts: [
        { bankCode: "50515", bankName: "Moniepoint MFB", accountNumber: "1000000001", accountName: "Ada B" },
        { bankCode: "232", bankName: "Sterling Bank", accountNumber: "2000000002", accountName: "Ada B" },
      ],
      raw: {},
    });
    const service = buildService(reserveAccount);

    const result = await (service as any).reserveRealAccount(
      "host-1",
      "12345678901",
      "ada@example.com",
      "Ada Bookings",
    );

    expect(result.accounts).toHaveLength(2);
    expect(result.accounts.map((a: { bankCode: string }) => a.bankCode)).toEqual(["50515", "232"]);
    expect(result.patch).toMatchObject({
      reservedAccountNumber: "1000000001",
      reservedBankName: "Moniepoint MFB",
      reservedAccountName: "Ada B",
      monnifyWalletReference: "host-1",
    });
  });

  it("falls back to the top-level accountName when the per-account name is absent", async () => {
    const reserveAccount = jest.fn().mockResolvedValue({
      accountReference: "host-2",
      accountName: "Bola Bookings",
      accounts: [{ bankCode: "50515", bankName: "Moniepoint MFB", accountNumber: "1000000003" }],
      raw: {},
    });
    const service = buildService(reserveAccount);

    const result = await (service as any).reserveRealAccount(
      "host-2",
      "12345678902",
      "bola@example.com",
      "Bola Bookings",
    );

    expect(result.patch.reservedAccountName).toBe("Bola Bookings");
  });

  it("falls back to the requested accountName when Monnify supplies no name at all", async () => {
    const reserveAccount = jest.fn().mockResolvedValue({
      accountReference: "host-3",
      accountName: undefined,
      accounts: [{ bankCode: "50515", bankName: "Moniepoint MFB", accountNumber: "1000000004" }],
      raw: {},
    });
    const service = buildService(reserveAccount);

    const result = await (service as any).reserveRealAccount(
      "host-3",
      "12345678903",
      "chidi@example.com",
      "Chidi Bookings",
    );

    expect(result.patch.reservedAccountName).toBe("Chidi Bookings");
  });

  it("requests only the preferred bank when MONNIFY_RESERVED_ACCOUNT_BANK_CODE is set", async () => {
    const reserveAccount = jest.fn().mockResolvedValue({
      accountReference: "host-4",
      accounts: [{ bankCode: "50515", bankName: "Moniepoint MFB", accountNumber: "1000000005" }],
      raw: {},
    });
    const service = buildService(
      reserveAccount,
      fakeConfig({ "monnify.reservedAccountBankCode": "50515" }),
    );

    await (service as any).reserveRealAccount("host-4", "12345678904", "d@example.com", "D Bookings");

    expect(reserveAccount).toHaveBeenCalledWith(
      expect.objectContaining({ preferredBankCodes: ["50515"] }),
    );
  });

  it("throws when no email is supplied", async () => {
    const service = buildService(jest.fn());
    await expect(
      (service as any).reserveRealAccount("host-5", "12345678905", undefined, "E Bookings"),
    ).rejects.toThrow(BadRequestException);
  });

  it("throws when Monnify returns an empty accounts array", async () => {
    const reserveAccount = jest.fn().mockResolvedValue({ accountReference: "host-6", accounts: [], raw: {} });
    const service = buildService(reserveAccount);

    await expect(
      (service as any).reserveRealAccount("host-6", "12345678906", "f@example.com", "F Bookings"),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
