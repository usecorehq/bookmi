import type { SupabaseDb } from "../../../drizzle/drizzle.module";
import type { ParsedWebhook } from "../providers/payment-provider.interface";
import { ReservedAccountWebhookService } from "./reserved-account-webhook.service";
import type { WalletLedgerService } from "../../hosts/services/wallet-ledger.service";

/**
 * Hand-rolled chainable fake mirroring the subset of drizzle's query-builder
 * API this service actually calls (`select().from().where().limit()`,
 * `insert().values().onConflictDoNothing()[.returning()]`). Every method
 * returns the same chain object, which is itself thenable so `await`ing at
 * any point in the chain resolves to `result` — matching how drizzle's own
 * builders are awaitable without an explicit terminal call.
 */
function makeChain(result: unknown) {
  const chain: Record<string, unknown> = {
    from: () => chain,
    where: () => chain,
    limit: () => Promise.resolve(result),
    values: () => chain,
    onConflictDoNothing: () => chain,
    returning: () => Promise.resolve(result),
    then: (resolve: (v: unknown) => void) => resolve(result),
  };
  return chain;
}

function fakeDb(opts: { walletExists: boolean; insertReturns: unknown[] }) {
  const selectChain = makeChain(opts.walletExists ? [{ hostId: "host-1" }] : []);
  const insertChain = makeChain(opts.insertReturns);
  const trxInsert = jest.fn(() => insertChain);
  const db = {
    select: jest.fn(() => selectChain),
    insert: jest.fn(() => insertChain),
    transaction: jest.fn(async (cb: (trx: unknown) => Promise<unknown>) =>
      cb({ insert: trxInsert }),
    ),
  };
  return { db, trxInsert };
}

function baseWebhook(overrides: Partial<ParsedWebhook> = {}): ParsedWebhook {
  return {
    providerEventId: "monnify:RESERVED_ACCOUNT_TRANSACTION:MNFY|RA|1",
    providerReference: "monnify-ra-ref-1",
    providerTransactionId: "MNFY|RA|1",
    domain: "reserved_account_credit",
    accountReference: "host-1",
    status: "success",
    eventName: "RESERVED_ACCOUNT_TRANSACTION",
    amountMinor: 500_000,
    currency: "NGN",
    raw: {},
    ...overrides,
  };
}

describe("ReservedAccountWebhookService", () => {
  it("inserts a wallet_topups row and appends a ledger credit with a real sourceId", async () => {
    const { db, trxInsert } = fakeDb({ walletExists: true, insertReturns: [{ id: "topup-1" }] });
    const appendEntry = jest.fn().mockResolvedValue({});
    const service = new ReservedAccountWebhookService(
      db as unknown as SupabaseDb,
      { appendEntry } as unknown as WalletLedgerService,
    );

    const result = await service.reconcile(baseWebhook());

    expect(result).toEqual({ handled: true });
    expect(trxInsert).toHaveBeenCalled();
    expect(appendEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        hostId: "host-1",
        amountKobo: 500_000,
        type: "credit",
        sourceType: "reserved_account",
        sourceMode: "wallet_topup",
        sourceId: "topup-1",
      }),
    );
  });

  it("skips the ledger append when the webhook is a redelivery (insert conflicts)", async () => {
    const { db } = fakeDb({ walletExists: true, insertReturns: [] });
    const appendEntry = jest.fn();
    const service = new ReservedAccountWebhookService(
      db as unknown as SupabaseDb,
      { appendEntry } as unknown as WalletLedgerService,
    );

    const result = await service.reconcile(baseWebhook());

    expect(result).toEqual({ handled: true });
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("records a failed wallet_topups row and never touches the ledger", async () => {
    const { db } = fakeDb({ walletExists: true, insertReturns: [] });
    const appendEntry = jest.fn();
    const service = new ReservedAccountWebhookService(
      db as unknown as SupabaseDb,
      { appendEntry } as unknown as WalletLedgerService,
    );

    const result = await service.reconcile(
      baseWebhook({ status: "failed", failureReason: "Insufficient funds" }),
    );

    expect(result).toEqual({ handled: true });
    expect(db.insert).toHaveBeenCalled();
    expect(db.transaction).not.toHaveBeenCalled();
    expect(appendEntry).not.toHaveBeenCalled();
  });

  it("returns handled:false without any writes when accountReference is missing", async () => {
    const { db } = fakeDb({ walletExists: true, insertReturns: [] });
    const appendEntry = jest.fn();
    const service = new ReservedAccountWebhookService(
      db as unknown as SupabaseDb,
      { appendEntry } as unknown as WalletLedgerService,
    );

    const result = await service.reconcile(baseWebhook({ accountReference: undefined }));

    expect(result.handled).toBe(false);
    expect(db.select).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });

  it("returns handled:false without any writes when amountMinor is missing", async () => {
    const { db } = fakeDb({ walletExists: true, insertReturns: [] });
    const service = new ReservedAccountWebhookService(
      db as unknown as SupabaseDb,
      { appendEntry: jest.fn() } as unknown as WalletLedgerService,
    );

    const result = await service.reconcile(baseWebhook({ amountMinor: undefined }));

    expect(result.handled).toBe(false);
    expect(db.select).not.toHaveBeenCalled();
  });

  it("returns handled:false when no host_wallets row matches the account reference", async () => {
    const { db } = fakeDb({ walletExists: false, insertReturns: [] });
    const appendEntry = jest.fn();
    const service = new ReservedAccountWebhookService(
      db as unknown as SupabaseDb,
      { appendEntry } as unknown as WalletLedgerService,
    );

    const result = await service.reconcile(baseWebhook());

    expect(result.handled).toBe(false);
    expect(db.insert).not.toHaveBeenCalled();
    expect(appendEntry).not.toHaveBeenCalled();
  });
});
