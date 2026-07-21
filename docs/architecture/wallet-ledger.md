# The wallet ledger: an immutable hash chain

`bookmi.wallet_ledger` is the source of truth for every change to a host's wallet balance — both money coming in ([Payments](payments.md), a booking settling) and money going out ([Payouts and refunds](payouts.md), a withdrawal or refund). This doc covers the ledger itself; the other two cover what writes to it and why.

`host_wallets.balance_kobo` is a **cache** — it's always equal to the `balance_after_kobo` of the host's most recent `wallet_ledger` row. The ledger is the record; the wallet row is just the fast-read denormalization of its tip.

Every credit or debit against `host_wallets.balance_kobo` inserts a row into `wallet_ledger` **in the same transaction** as the balance mutation — enforced by convention (`WalletLedgerService.appendEntry` is the only writer), not by a DB trigger.

Each row (`apps/api/src/drizzle/schema.ts:477-507`) records:

| Column | Purpose |
|---|---|
| `amount_kobo`, `type` (`credit`\|`debit`) | The delta and its direction. |
| `source_type` (`payment_transaction`\|`payout`\|`refund`), `source_id` | Which domain table caused this entry. |
| `source_mode` (`booking`\|`tip`\|`withdrawal`\|`refund`) | The business intent — answers "what caused this ₦ delta" without a join. |
| `balance_before_kobo`, `balance_after_kobo` | Snapshot either side of the move. You can reconstruct a host's balance at any point by reading one row — no summing. |
| `status` (`pending`\|`success`\|`failed`\|`cancelled`) | Mutable. Deliberately **excluded** from the hash so a webhook flipping a payout `pending → failed` doesn't break the chain. |
| `current_hash`, `prev_hash` | `current_hash` = hash of every other immutable column + this host's previous `current_hash`. First entry for a host chains onto the sentinel `GENESIS`. |

Why this exists: it's a tamper-evident audit trail. Alter any historical `amount_kobo` (or any other hashed column) on any row and every `current_hash` after it stops matching what a recomputation would produce — a `verifyChain` walk over a host's rows points at the first break.

## `appendEntry` — the only way to move a balance

`apps/api/src/modules/hosts/services/wallet-ledger.service.ts` — `appendEntry(input)`:

1. `SELECT ... FOR UPDATE` the host's `host_wallets` row inside the caller's transaction. This is the serialization point — no per-host advisory lock needed, because every ledger write is paired with this row lock.
2. Compute the new balance (`credit` → `+amount`, `debit` → `-amount`). A debit that would drive the balance negative throws — belt-and-braces, since every caller has already re-checked balance under the same lock upstream.
3. Read the host's last ledger row's `current_hash` (or `GENESIS` if this is the first).
4. Insert the new row with the computed hash.
5. Update `host_wallets.balance_kobo` to match.

Callers always run this inside a transaction that also writes the source row (`payouts`, `refunds`, or the payment-success handler), so the ledger entry and the domain-row mutation commit or roll back together — there's no way for a payout to exist without a matching ledger entry, or vice versa.

`updateStatus(entryId, status)` is the one mutation allowed outside that discipline — it flips `status` in place (e.g. a delayed webhook resolving a payout or refund from `pending` to `failed`) without touching any hashed column. Its first real caller is the refund-webhook reconciler described in [Payouts, refunds, and the wallet ledger](payouts.md#refund-webhook-reconciliation).

## Who writes to it

| Caller | `type` | `sourceType` | `sourceMode` |
|---|---|---|---|
| `BookingCheckoutHandler.onSuccess` | `credit` | `payment_transaction` | `booking` (or `tip`) |
| `HostWalletService.withdraw()` | `debit` | `payout` | `withdrawal` |
| `HostBookingsService.refundBooking()` | `debit` | `refund` | `refund` |
| `RefundWebhookService.reconcile()` (compensating credit on a failed refund) | `credit` | `refund` | `refund` |

## Files

| File | What it holds |
|---|---|
| `apps/api/src/drizzle/schema.ts` | `wallet_ledger`, `host_wallets` table definitions |
| `apps/api/src/drizzle/migrations/0006_wallet_ledger.sql` | The `wallet_ledger` table |
| `apps/api/src/modules/hosts/services/wallet-ledger.service.ts` | `appendEntry`, `updateStatus`, hash computation |
| `packages/shared-types/src/wallet-ledger.ts` | Ledger entry types shared with the frontend |

## Related

- [Payments](payments.md) — the money-in side; `onSuccess` is the first writer into the ledger
- [Payouts, refunds, and the wallet ledger](payouts.md) — the money-out side; withdrawals, refunds, and the refund-webhook reconciler that also writes here
