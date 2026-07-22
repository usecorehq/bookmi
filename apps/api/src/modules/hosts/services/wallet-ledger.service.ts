import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { SUPABASE_DB, type SupabaseDb } from "../../../drizzle/drizzle.module";
import {
  hostProfiles,
  hostWallets,
  walletLedger,
  type LedgerEntryStatus,
  type LedgerEntryType,
  type LedgerSourceMode,
  type LedgerSourceType,
  type WalletLedgerEntry,
} from "../../../drizzle/schema";

/**
 * Any drizzle handle the append path can compose against — either the top-
 * level SupabaseDb or a transaction handle from `db.transaction(async trx
 * => { ... })`. Both share the read/write surface we need. Using the top-
 * level type would exclude transactions (they lack `$client`); using the
 * transaction type would exclude the top-level db.
 */
type LedgerTx = Parameters<Parameters<SupabaseDb["transaction"]>[0]>[0];

/**
 * Anything a caller passes to appendEntry. `trx` is a drizzle transaction
 * handle — the caller MUST run this inside a transaction that also mutates
 * the underlying source row, so the ledger row and the source row commit
 * together or not at all.
 */
export interface AppendEntryInput {
  trx: LedgerTx;
  hostId: string;
  amountKobo: number;
  type: LedgerEntryType;
  sourceType: LedgerSourceType;
  sourceMode: LedgerSourceMode;
  sourceId: string | null;
  status?: LedgerEntryStatus;
  memo?: string | null;
}

/**
 * Fields covered by `current_hash`. Deliberately excludes `status` and
 * `updated_at` so a late webhook that flips `pending → success/failed`
 * doesn't break the chain from that row forward. Every other column is
 * covered — a single altered kobo breaks the chain and `verifyChain`
 * surfaces it.
 */
interface HashInputs {
  prevHash: string;
  id: string;
  hostId: string;
  amountKobo: number;
  type: LedgerEntryType;
  sourceType: LedgerSourceType;
  sourceMode: LedgerSourceMode;
  sourceId: string | null;
  balanceBeforeKobo: number;
  balanceAfterKobo: number;
  createdAt: Date;
}

/** Sentinel prev_hash for a host's very first entry. */
const GENESIS_HASH = "GENESIS";

/** Optional narrowing for `list`/`listForUser` — the Transactions page's filter bar. */
export interface LedgerListFilters {
  type?: LedgerEntryType;
  sourceType?: LedgerSourceType;
  sourceMode?: LedgerSourceMode;
  status?: LedgerEntryStatus;
  from?: Date;
  to?: Date;
}

export type LedgerListOptions = LedgerListFilters & { limit?: number; offset?: number };

/**
 * Immutable, hash-chained wallet ledger. Every credit + debit against a
 * host wallet flows through appendEntry inside the same transaction that
 * mutates the source domain row (payment_transaction / payout / refund).
 * That gives us:
 *
 *   1. Atomicity — the balance move and the ledger row commit together.
 *   2. Tamper-evidence — each row's hash covers prev_hash + all immutable
 *      fields; verifyChain walks the whole thing and points at the first
 *      break.
 *   3. Provable state — balance_before + balance_after on every row means
 *      you can rebuild a wallet's balance at any point in time by summing
 *      no rows at all (just read the last one).
 *
 * Deliberate simplifications:
 *   - `status` is mutable (pending → success/failed) so a late webhook
 *     doesn't require a compensating row for every state flip. It is NOT
 *     hashed; every other field is.
 *   - No per-host advisory lock — we serialize via row-level lock on
 *     host_wallets (SELECT ... FOR UPDATE inside appendEntry), which is
 *     sufficient because every ledger write is paired with a wallet
 *     mutation.
 */
@Injectable()
export class WalletLedgerService {
  private readonly logger = new Logger(WalletLedgerService.name);

  constructor(@Inject(SUPABASE_DB) private readonly db: SupabaseDb) {}

  /**
   * Atomically:
   *   1. Row-lock the host_wallets row.
   *   2. Compute new balance (credit: +amount, debit: -amount). Debit that
   *      would drive the balance negative throws — every caller has already
   *      re-checked balance under the same lock upstream, so this is a
   *      belt-and-braces guard.
   *   3. Read the host's last ledger row's current_hash.
   *   4. Insert the new ledger row with computed hash.
   *   5. Update host_wallets.balance_kobo to the new balance.
   *
   * Returns the freshly-inserted ledger entry.
   *
   * Runs inside the caller's transaction (`input.trx`) so a failure at any
   * point rolls the source-domain write back with it.
   */
  async appendEntry(input: AppendEntryInput): Promise<WalletLedgerEntry> {
    const { trx, hostId, amountKobo, type, sourceType, sourceMode, sourceId } = input;
    if (!Number.isFinite(amountKobo) || amountKobo <= 0) {
      throw new BadRequestException("Ledger entry amount must be a positive integer (kobo).");
    }
    const status: LedgerEntryStatus = input.status ?? "success";

    // Step 1 — lock the host_wallets row so no concurrent ledger write can
    // race the balance read → hash lookup → insert sequence. Also upserts
    // the wallet row for hosts whose signup somehow skipped it.
    const [walletBefore] = await trx
      .select({ balanceKobo: hostWallets.balanceKobo })
      .from(hostWallets)
      .where(eq(hostWallets.hostId, hostId))
      .for("update")
      .limit(1);
    let balanceBefore = walletBefore?.balanceKobo ?? 0;
    if (!walletBefore) {
      // First-ever entry for this host + no wallet row yet. Create one
      // inside the same tx so the FOR UPDATE lock stays honored.
      await trx.insert(hostWallets).values({ hostId, balanceKobo: 0 });
      balanceBefore = 0;
    }

    const delta = type === "credit" ? amountKobo : -amountKobo;
    const balanceAfter = balanceBefore + delta;
    if (balanceAfter < 0) {
      throw new BadRequestException(
        `Ledger debit of ${amountKobo} would drive balance below zero (current ${balanceBefore}).`,
      );
    }

    // Step 2 — find the previous entry for this host to chain onto.
    const [prev] = await trx
      .select({ currentHash: walletLedger.currentHash })
      .from(walletLedger)
      .where(eq(walletLedger.hostId, hostId))
      .orderBy(desc(walletLedger.createdAt), desc(walletLedger.id))
      .limit(1);
    const prevHash = prev?.currentHash ?? GENESIS_HASH;

    // Step 3 — mint the id + timestamp client-side so they can feed the
    // hash before the row is written.
    const id = crypto.randomUUID();
    const createdAt = new Date();
    const currentHash = computeHash({
      prevHash,
      id,
      hostId,
      amountKobo,
      type,
      sourceType,
      sourceMode,
      sourceId: sourceId ?? null,
      balanceBeforeKobo: balanceBefore,
      balanceAfterKobo: balanceAfter,
      createdAt,
    });

    // Step 4 — insert the ledger row.
    const [entry] = await trx
      .insert(walletLedger)
      .values({
        id,
        hostId,
        amountKobo,
        type,
        sourceId: sourceId ?? null,
        sourceType,
        sourceMode,
        balanceBeforeKobo: balanceBefore,
        balanceAfterKobo: balanceAfter,
        status,
        memo: input.memo ?? null,
        currentHash,
        prevHash: prev?.currentHash ?? null,
        createdAt,
        updatedAt: createdAt,
      })
      .returning();
    if (!entry) {
      throw new Error("Failed to insert wallet ledger row.");
    }

    // Step 5 — move the wallet balance to match. Upsert to cover the
    // first-write case seeded above.
    await trx
      .update(hostWallets)
      .set({ balanceKobo: balanceAfter, updatedAt: createdAt })
      .where(eq(hostWallets.hostId, hostId));

    return entry;
  }

  /**
   * Flip a ledger entry's `status`. Safe to call whenever a source row's
   * status changes (e.g. a webhook flips a payout from pending → failed).
   * The hash chain is unaffected because `status` is intentionally
   * excluded from the hash inputs.
   */
  async updateStatus(entryId: string, status: LedgerEntryStatus): Promise<void> {
    await this.db
      .update(walletLedger)
      .set({ status, updatedAt: new Date() })
      .where(eq(walletLedger.id, entryId));
  }

  /**
   * Walk the whole chain for a host, re-computing each row's hash and
   * comparing to what's stored. Returns `{ ok: true }` if intact, or
   * `{ ok: false, brokenAt }` pointing at the first bad row. Read-only.
   * Intended for admin / audit use — cheap enough at MVP volumes to run
   * per-request but should be gated behind a background job at scale.
   */
  async verifyChain(hostId: string): Promise<
    | { ok: true; entries: number }
    | { ok: false; brokenAt: string; reason: string }
  > {
    const rows = await this.db
      .select()
      .from(walletLedger)
      .where(eq(walletLedger.hostId, hostId))
      .orderBy(walletLedger.createdAt, walletLedger.id);

    let expectedPrev = GENESIS_HASH;
    let runningBalance = 0;
    for (const row of rows) {
      // Chain link check.
      if ((row.prevHash ?? GENESIS_HASH) !== expectedPrev) {
        return { ok: false, brokenAt: row.id, reason: "prev_hash mismatch" };
      }

      // Balance continuity check.
      if (row.balanceBeforeKobo !== runningBalance) {
        return { ok: false, brokenAt: row.id, reason: "balance_before mismatch" };
      }
      const expectedAfter =
        row.type === "credit"
          ? runningBalance + row.amountKobo
          : runningBalance - row.amountKobo;
      if (row.balanceAfterKobo !== expectedAfter) {
        return { ok: false, brokenAt: row.id, reason: "balance_after mismatch" };
      }

      // Hash recomputation.
      const recomputed = computeHash({
        prevHash: expectedPrev,
        id: row.id,
        hostId: row.hostId,
        amountKobo: row.amountKobo,
        type: row.type as LedgerEntryType,
        sourceType: row.sourceType as LedgerSourceType,
        sourceMode: row.sourceMode as LedgerSourceMode,
        sourceId: row.sourceId,
        balanceBeforeKobo: row.balanceBeforeKobo,
        balanceAfterKobo: row.balanceAfterKobo,
        createdAt: row.createdAt,
      });
      if (recomputed !== row.currentHash) {
        return { ok: false, brokenAt: row.id, reason: "current_hash mismatch" };
      }

      expectedPrev = row.currentHash;
      runningBalance = expectedAfter;
    }
    return { ok: true, entries: rows.length };
  }

  /** Same as list, but resolves the host from the authenticated user. */
  async listForUser(
    userId: string,
    opts: LedgerListOptions = {},
  ): Promise<{ items: WalletLedgerEntry[]; total: number }> {
    const hostId = await this.resolveHostId(userId);
    return this.list(hostId, opts);
  }

  /** Same as dailyGrossByMode, but resolves the host from the auth'd user. */
  async dailyGrossByModeForUser(
    userId: string,
    days = 30,
  ): Promise<Array<{ date: string; bookingKobo: number; tipKobo: number }>> {
    const hostId = await this.resolveHostId(userId);
    return this.dailyGrossByMode(hostId, days);
  }

  private async resolveHostId(userId: string): Promise<string> {
    const [row] = await this.db
      .select({ id: hostProfiles.id })
      .from(hostProfiles)
      .where(eq(hostProfiles.userId, userId))
      .limit(1);
    if (!row) throw new NotFoundException("Complete onboarding first.");
    return row.id;
  }

  /**
   * Read-only list, newest-first — powers both the dashboard's small
   * "Recent transactions" widget (no filters, `limit: 10`) and the full
   * paginated Transactions statement-of-account page (filters + `total`
   * for page-count rendering). Filters are all optional and purely
   * additive — an unfiltered call behaves exactly as before.
   */
  async list(
    hostId: string,
    opts: LedgerListOptions = {},
  ): Promise<{ items: WalletLedgerEntry[]; total: number }> {
    const where = this.buildWhere(hostId, opts);

    const items = await this.db
      .select()
      .from(walletLedger)
      .where(where)
      .orderBy(desc(walletLedger.createdAt), desc(walletLedger.id))
      .limit(opts.limit ?? 25)
      .offset(opts.offset ?? 0);

    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(walletLedger)
      .where(where);

    return { items, total: row?.count ?? 0 };
  }

  private buildWhere(hostId: string, filters: LedgerListFilters) {
    const conditions = [eq(walletLedger.hostId, hostId)];
    if (filters.type) conditions.push(eq(walletLedger.type, filters.type));
    if (filters.sourceType) conditions.push(eq(walletLedger.sourceType, filters.sourceType));
    if (filters.sourceMode) conditions.push(eq(walletLedger.sourceMode, filters.sourceMode));
    if (filters.status) conditions.push(eq(walletLedger.status, filters.status));
    if (filters.from) conditions.push(gte(walletLedger.createdAt, filters.from));
    if (filters.to) conditions.push(lte(walletLedger.createdAt, filters.to));
    return and(...conditions);
  }

  /**
   * Daily gross credits by source_mode for the last `days` days. Feeds the
   * dashboard bar chart. Bucket key is the entry's date in the wallet
   * owner's local TZ (UTC for now — hosts are all NG so it's ≈ WAT which
   * is UTC+1; a bucket at midnight WAT stays coherent within a day).
   */
  async dailyGrossByMode(
    hostId: string,
    days = 30,
  ): Promise<Array<{ date: string; bookingKobo: number; tipKobo: number }>> {
    const now = new Date();
    const from = new Date(now);
    from.setUTCDate(from.getUTCDate() - (days - 1));
    from.setUTCHours(0, 0, 0, 0);

    // Only credit-side ledger entries with source_mode ∈ {booking, tip}.
    // Withdrawals + refunds excluded — those are on the debit side and go
    // to a different panel.
    const rows = await this.db
      .select({
        day: sql<string>`to_char(date_trunc('day', ${walletLedger.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
        mode: walletLedger.sourceMode,
        totalKobo: sql<number>`sum(${walletLedger.amountKobo})::bigint`,
      })
      .from(walletLedger)
      .where(
        and(
          eq(walletLedger.hostId, hostId),
          eq(walletLedger.type, "credit"),
          gte(walletLedger.createdAt, from),
          lte(walletLedger.createdAt, now),
        ),
      )
      .groupBy(sql`1`, walletLedger.sourceMode);

    // Fill every day in the range so the chart has 30 bars even on quiet
    // days. Bucket ordering is chronological.
    const buckets = new Map<string, { bookingKobo: number; tipKobo: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(from);
      d.setUTCDate(from.getUTCDate() + i);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { bookingKobo: 0, tipKobo: 0 });
    }
    for (const r of rows) {
      const bucket = buckets.get(r.day);
      if (!bucket) continue;
      const kobo = Number(r.totalKobo);
      if (r.mode === "booking") bucket.bookingKobo += kobo;
      else if (r.mode === "tip") bucket.tipKobo += kobo;
    }
    return Array.from(buckets.entries()).map(([date, v]) => ({
      date,
      bookingKobo: v.bookingKobo,
      tipKobo: v.tipKobo,
    }));
  }
}

function computeHash(input: HashInputs): string {
  // Canonical serialization — sorted keys, ISO timestamp, explicit null
  // handling — so the same logical row always hashes to the same bytes.
  const canonical = [
    input.prevHash,
    input.id,
    input.hostId,
    String(input.amountKobo),
    input.type,
    input.sourceType,
    input.sourceMode,
    input.sourceId ?? "null",
    String(input.balanceBeforeKobo),
    String(input.balanceAfterKobo),
    input.createdAt.toISOString(),
  ].join("|");
  return createHash("sha256").update(canonical).digest("hex");
}
