# Payouts and refunds

> Diagram: [payout/refund sequence](../diagrams/images/payout-flow.svg)

[Payments](payments.md) covers money coming **in** — checkout, verify, webhooks. This doc covers money moving **out of** a host's wallet (withdrawals) and **back to** a customer (refunds).

## The accounting tables

| Table | One row per | Purpose |
|---|---|---|
| `bookmi.host_wallets` | host | Current spendable `balance_kobo` + the saved payout destination (`bank_code`, `bank_account_number`, `bank_account_name`). One row, keyed on `host_id`. |
| `bookmi.payouts` | withdrawal attempt | State machine for a host pulling money out to their bank. |
| `bookmi.refunds` | refund attempt | State machine for sending a customer's money back. Mirrors `payouts` plus `booking_id` + `reason`. |
| `bookmi.wallet_ledger` | balance-changing event | Append-only, hash-chained. The source of truth for "why did this balance change." |
| `bookmi.security_challenges` | OTP challenge | Backs the 2FA gate in front of both withdraw and refund. |

`host_wallets.balance_kobo` is a **cache** — it's always equal to the `balance_after_kobo` of the host's most recent `wallet_ledger` row. The ledger is the record; the wallet row is just the fast-read denormalization of its tip.

The ledger itself — the hash-chained `wallet_ledger` table, `WalletLedgerService.appendEntry`/`updateStatus`, and who writes to it — is documented separately in **[The wallet ledger](wallet-ledger.md)**, since both this doc (debits) and [Payments](payments.md) (credits) write to it as peers. Everything below assumes that doc as background.

## Payouts (host withdrawals)

`HostWalletService.withdraw()` — `apps/api/src/modules/hosts/services/host-wallet.service.ts:208-380`.

Preconditions: the host must have a saved payout account (`host_wallets.bank_code/bank_account_number/bank_account_name`, set via `savePayoutAccount` after server-side name resolution against the provider — never trusts the client's `accountName` verbatim).

Sequence:

1. **Insert-first idempotency claim.** A `payouts` row is inserted with `status: "processing"` before Monnify is ever touched, keyed on `(host_id, idempotency_key)` (partial unique index — `WHERE idempotency_key IS NOT NULL`). A retried request with the same key and the **same `amountKobo`** hits `onConflictDoNothing`, finds no new row, and returns the **cached** row instead of a second disbursement. If the cached row's `amountKobo` differs from the current request, that's not a retry — it's a stale key reused for a materially different withdrawal (e.g. the host corrected the amount after a failed attempt without getting a fresh key) — rejected with a clear error instead of silently surfacing the wrong cached row's amount/status. The same guard exists on the refund path below, keyed additionally on destination bank/account.
2. **OTP gate.** `SecurityService.verifyAndConsume(userId, "withdraw_funds", otpCode)`. Failing here is pre-disbursement — no money has moved — so the claim row from step 1 is deleted, letting the host retry the same idempotency key with a fresh code instead of getting stuck on a cached failure.
3. **Advisory lock + disburse**, inside one DB transaction:
   - `pg_advisory_xact_lock(hashtextextended(hostId, 2))` — serializes concurrent withdrawal attempts for the same host.
   - Re-read `host_wallets.balance_kobo` under the lock; reject if it's below the requested amount (the balance may have moved since the pre-check).
   - Call `provider.disburse()` (Monnify `POST /api/v2/disbursements/single`) with a **deterministic reference** (`payout_<payoutRow.id>`) so a network-level retry to Monnify is deduped provider-side too.
   - Update the `payouts` row with `monnify_reference` + the provider's returned status.
   - `WalletLedgerService.appendEntry()` — a `debit` entry, `sourceType: "payout"`, `sourceMode: "withdrawal"`, `sourceId: payoutRow.id`. Same transaction — the balance move and the payout row commit together or not at all.
4. Any failure after the claim row exists (disburse throws, balance check fails) marks the `payouts` row `failed` with a truncated `failure_reason` — the idempotency key stays claimed, so a genuinely-failed attempt doesn't silently retry into a duplicate disbursement; the host needs a fresh key.

**Known MVP simplification** (documented in code, not yet closed): any non-`failed` status Monnify returns from the initial `disburse` call is treated as final and debited immediately. In reality Monnify can return `PENDING_AUTHORIZATION` or similar and only confirm via a later webhook — payouts don't yet have an equivalent to the refund flow's webhook reconciler below. The ledger row's `status` field exists specifically so a future webhook handler can reconcile this without touching the hash chain.

### API surface

All routes: `apps/api/src/modules/hosts/controllers/host-wallet.controller.ts`, mounted at `hosts/me/wallet`.

| Method | Path | Purpose |
|---|---|---|
| GET | `/` | Wallet snapshot: balance, reserved account (if provisioned), 10 most recent bookings + payouts. |
| GET | `/banks` | Bank list for the payout dropdown (24h in-process cache, `HostWalletService.listBanks`). |
| POST | `/verify-bank-account` | Resolve `{bankCode, accountNumber}` → account holder name via the provider. Pure lookup, not persisted. |
| POST | `/payout-account` | Persist the verified destination triple. Server re-resolves and rejects a name mismatch. |
| POST | `/withdraw` | Body: `{ amountKobo }`. **Requires** `x-idempotency-key` (8–100 chars) and `x-otp-code` (6 digits) headers. Destination bank comes from the saved `host_wallets` row — never the request body — closing off a "swap the destination mid-session" attack. |

OTP codes are minted via a separate endpoint: `POST /hosts/me/security/otp/challenge` (`apps/api/src/modules/security/security.controller.ts`), body `{ purpose: "withdraw_funds" | "refund_booking" }`. It emails a 6-digit code and returns only the challenge id + expiry — never the code itself. `SecurityService` rate-limits to 3 non-expired challenges per `(user, purpose)` and self-locks a challenge after 5 failed verify attempts (`securityChallenges.failedAttempts`, `apps/api/src/drizzle/schema.ts:515-535`).

### Frontend

- `apps/web/src/components/dashboard/profile/PayoutSection.tsx` — payout-account setup form (bank picker + account-number → auto-verify-on-type via `verify-bank-account`).
- `apps/web/src/hooks/useBanks.ts` — bank list + `useSavePayoutAccount`.
- `apps/web/src/pages/dashboard/WalletPage.tsx` — balance, all-time earned, in-flight payouts KPIs; `WithdrawModal` drives the OTP request → withdraw call.
- `apps/web/src/hooks/useWithdraw.ts` — `POST /hosts/me/wallet/withdraw`, sending `X-Idempotency-Key` + `X-OTP-Code` headers, invalidates the `host-wallet` query on success.

## Refunds

`HostBookingsService.refundBooking()` (`apps/api/src/modules/hosts/services/host-bookings.service.ts`, ~line 297) follows the identical insert-first-claim → OTP-gate → advisory-lock-and-disburse → ledger-append shape as withdrawals, against the `refunds` table instead of `payouts`:

- Unique on `(booking_id, idempotency_key)` instead of `(host_id, idempotency_key)`.
- Deterministic Monnify reference: `refund_<refundRow.id>`.
- Ledger entry: `debit`, `sourceType: "refund"`, `sourceMode: "refund"`, `sourceId: refundRow.id`.
- OTP purpose is `refund_booking` rather than `withdraw_funds`.
- Same cache-hit mismatch guard as payouts: a cached row is only returned if `amountKobo`, `destinationBankCode`, and `destinationAccountNumber` all match the current request — otherwise the key was reused for a different refund and the request is rejected with a clear error.

Refunds also write `bookings.refunded_amount_kobo` / `refund_reason` / `refunded_at` — that's booking-level bookkeeping alongside (not instead of) the ledger entry.

**Frontend note:** `RefundModal.tsx`/`WithdrawModal` (in `WalletPage.tsx`) mint a fresh idempotency key whenever the host navigates back to correct details (amount, bank, account) after a failed confirm — reusing the same key across a corrected resubmission is exactly the scenario the backend guard above rejects, so the frontend needs to hand over a new key rather than rely on the guard alone to recover gracefully.

### Provider call: `disburse()` today, `refund()` behind a rollout flag

Historically the refund flow called the exact same generic Single Transfer/Disbursement API as host payouts (`provider.disburse()`), never Monnify's dedicated refund endpoint — a deliberate interim choice, since it was believed the dedicated endpoint couldn't redirect a refund to a different bank account. That belief was wrong: Monnify's refund API accepts optional `destinationAccountNumber`/`destinationAccountBankCode` overrides, same as `disburse()`.

`refundBooking()` now branches on `config.get("monnify.useRefundApi")` (env `MONNIFY_USE_REFUND_API`, **default `false`**):

- **Flag off (default — every existing deployment, unchanged):** calls `provider.disburse!()` exactly as before, and unconditionally records `refunds.status = "success"` / a `success` ledger entry the instant the provider call returns — the pre-existing MVP simplification (no wait for async settlement).
- **Flag on (opt-in, after a sandbox smoke test):** calls `provider.refund!()` — Monnify's `POST /api/v1/refunds/initiate-refund` — addressing the *original* transaction by Monnify's own reference rather than moving money to an arbitrary destination from scratch:
  - Requires `bookings.payment_transaction_id` (legacy/dashboard-created bookings with no online payment can't use this path — they still need `disburse()`, i.e. the flag stays off for them today).
  - Reads `payment_transactions.provider_transaction_id` — Monnify's own transaction reference, distinct from `provider_reference` (bookmi's own minted reference, which is all that was captured before). Populated going forward by `verify()`/`parseWebhook()`. For any row written before this column existed, `refundBooking()` **JIT-backfills** it with one live `provider.verify()` call the first time that booking is refunded, then persists it so later refunds skip the extra round-trip.
  - **Corrected ledger-status mapping:** a genuinely in-flight refund (`refundStatus: "IN_PROGRESS"`) is recorded as `refunds.status = "processing"` / a `pending` ledger entry — not falsely marked `success` immediately like the `disburse()` path always does. It's resolved for real by the refund-webhook reconciler below.
  - Booking cancellation (`status → canceled`, `refunded_amount_kobo`, `refunded_at`) stays unconditional on initiate success/processing on **both** paths — that part doesn't change.

See [Monnify API usage](../guides/monnify-apis-usage.md) for the endpoint shape. Two open risks are flagged as code comments in `monnify.provider.ts` (`refund()` and `parseRefundWebhook()`) — the `refundAmount` wire type (Monnify's docs say "number," unlike every other amount field this codebase integrates with, which is a decimal string) and the refund webhook's exact field names (inferred by analogy to the `initiate-refund` response shape, not confirmed verbatim) — both worth a sandbox smoke test before flipping the flag on in production.

### Refund-webhook reconciliation

`RefundWebhookService` (`apps/api/src/modules/payments/services/refund-webhook.service.ts`) reconciles Monnify's `SUCCESSFUL_REFUND`/`FAILED_REFUND` webhooks — only reachable once the flag above is on, since the `disburse()` path never leaves a non-terminal `refunds` row behind for a webhook to resolve. `PaymentsService.processWebhook()` routes to it whenever `parsedWebhook.domain === "refund"`, after the existing edge-level dedup insert and before the payment-transaction finalize path.

`reconcile(parsed)`:

1. Look up `refunds` by `monnify_reference = parsed.providerReference` (`rf_monnify_ref_uniq`). No match → `handled: false`.
2. Already-terminal (`success`/`failed`) → no-op — idempotent against webhook redelivery.
3. Update `refunds.status` (+ `failure_reason` on failure) to the webhook's outcome.
4. Look up the matching `wallet_ledger` row (`sourceType: "refund"`, `sourceId: refund.id` — `wl_source_idx`) and call `WalletLedgerService.updateStatus()` to flip it from `pending` to `success`/`failed` — see [the wallet ledger doc](wallet-ledger.md) for why this doesn't touch the hash chain.
5. On `failed`: the refund was optimistically debited as `pending` at initiate time; a compensating **credit** ledger entry (same `sourceId`) restores the host's wallet balance. `appendEntry`'s own row lock on `host_wallets` is sufficient serialization on its own.

**Known judgment call:** a `FAILED_REFUND` after the booking was already marked `canceled` does **not** auto-revert the cancellation — the host may have already acted on it. The refund shows `failed` in the dashboard for manual follow-up instead.

## Reserved accounts

`HostWalletService.activateReservedAccount()` (`apps/api/src/modules/hosts/services/host-wallet.service.ts`) provisions a reserved/dedicated virtual account per host so third parties can pay a host directly by bank transfer. `POST /hosts/me/wallet/activate-reserved-account` collects the host's BVN (`host_wallets.bvn` — sensitive NDPR PII, persisted but never logged) and is idempotent — a host who already has one gets it back unchanged.

Branches on `config.get("monnify.useReservedAccountApi")` (env `MONNIFY_USE_RESERVED_ACCOUNT_API`, **default `false`**):

- **Flag off (default):** fabricates a plausible 10-digit account number + `"Moniepoint MFB"` as the bank name, so the product flow (pending-activation card → BVN form → dedicated account number) still demos end-to-end without live Monnify credentials. Nothing ever lands in a mock account — no webhook reconciliation applies.
- **Flag on (opt-in, after a sandbox smoke test):** calls `provider.reserveAccount()` — Monnify's `POST /api/v2/bank-transfer/reserved-accounts` (request/response shape confirmed against [Monnify's docs](https://developers.monnify.com/docs/collections/recurring-payments/reserved-accounts), not inferred) — with `accountReference: host.id`. That reference is also the correlator the reserved-account-credit webhook uses to map a transfer back to a host, with no side-table lookup; whether a *retried* call with the same reference upserts rather than errors isn't covered by the docs and is still worth a sandbox smoke test. Requires the host's email (from the authenticated JWT) — the request fails with a clear error if it's missing. An optional `MONNIFY_RESERVED_ACCOUNT_BANK_CODE` restricts provisioning to one partner bank; unset requests every bank Monnify supports (`getAllAvailableBanks: true`) and Monnify can return several.

**Multiple partner banks.** Every bank Monnify returns is persisted to `reserved_bank_accounts` (one row per bank, `host_id` + `account_number` unique), with the first one marked `is_active` — a partial unique index (`rba_host_active_uniq`, `WHERE is_active = true`) enforces at most one active row per host at the DB level. `host_wallets.reserved_account_number` / `reserved_bank_name` / `reserved_account_name` are a **denormalized cache** of whichever row is active — the same pattern as `balance_kobo` caching the ledger tip — and are what the wallet page shows; the host never sees the full list. Switching which bank is active has **no API today**: this repo has no admin auth/RBAC surface at all (the only "admin" thing that exists is the Bull Board queue dashboard, gated by plain env-var Basic Auth, not a real role system), so it's a manual DB update until real admin tooling exists.

### Reserved-account-webhook reconciliation

`ReservedAccountWebhookService` (`apps/api/src/modules/payments/services/reserved-account-webhook.service.ts`) reconciles Monnify's `RESERVED_ACCOUNT_TRANSACTION` webhook — fired when a transfer lands in a host's reserved account. Unlike a normal payment or refund, this event has no matching `payment_transactions`/`refunds` row, so `PaymentsService.processWebhook()` routes it (via `parsedWebhook.domain === "reserved_account_credit"`) to `wallet_topups` + a ledger credit instead of the finalize path:

1. Resolve the host from `parsed.accountReference` (= `host_wallets.host_id`, minted at activation time). No match → `handled: false`.
2. **Failed status:** insert a `wallet_topups` row (`status: "failed"`, `failure_reason`) for parity/audit with `payouts`/`refunds` — no money moved, so no ledger entry.
3. **Success status:** inside one transaction, insert a `wallet_topups` row (`provider_reference` = Monnify's `transactionReference`, deduped per-host via a partial unique index — a second line of defense beyond the upstream `payment_webhook_events` dedup) then `WalletLedgerService.appendEntry()` — a `credit` entry, `sourceType: "reserved_account"`, `sourceMode: "wallet_topup"`, `sourceId: <wallet_topups row id>`. Unlike the original version of this reconciler, `sourceId` is no longer `null` — there's a real, queryable row behind every credit. A redelivered webhook (same `provider_reference`) hits the unique-index conflict, so the ledger append is skipped rather than double-counted.

Only reachable once a host has a *real* reserved account (`MONNIFY_USE_RESERVED_ACCOUNT_API=true`) — mocked reserved accounts never receive an actual transfer, so no webhook ever arrives for them.

The exact `RESERVED_ACCOUNT_TRANSACTION` webhook field names (particularly `product.reference` for the account reference) are flagged as an open risk in `monnify.provider.ts`'s `parseReservedAccountWebhook()` comment — inferred from Monnify's docs, not a captured real payload. Smoke-test against sandbox before enabling the flag in production.

## Files

| File | What it holds |
|---|---|
| `apps/api/src/drizzle/schema.ts` | `host_wallets`, `payouts`, `refunds`, `reserved_bank_accounts`, `wallet_topups`, `wallet_ledger`, `security_challenges` table definitions; `payment_transactions.provider_transaction_id` |
| `apps/api/src/drizzle/migrations/0005_moneyout_idempotency_otp.sql` | Idempotency keys on `payouts`/`refunds` + `security_challenges` |
| `apps/api/src/drizzle/migrations/0006_wallet_ledger.sql` | The `wallet_ledger` table |
| `apps/api/src/drizzle/migrations/0007_payment_transaction_provider_id.sql` | `payment_transactions.provider_transaction_id` — Monnify's own transaction reference, captured so the dedicated refund API can address the original transaction |
| `apps/api/src/modules/hosts/services/wallet-ledger.service.ts` | `appendEntry`, `updateStatus`, hash computation |
| `apps/api/src/modules/hosts/services/host-wallet.service.ts` | Wallet snapshot, payout-account setup, `withdraw()`, `activateReservedAccount()` — branches on `monnify.useReservedAccountApi` |
| `apps/api/src/modules/hosts/services/host-bookings.service.ts` | `refundBooking()` — branches on `monnify.useRefundApi` |
| `apps/api/src/modules/hosts/controllers/host-wallet.controller.ts` | `hosts/me/wallet/*` routes |
| `apps/api/src/modules/hosts/dto/hosts.dto.ts` | `SavePayoutAccountSchema`, `WithdrawSchema`, `RefundBookingSchema`, `ActivateReservedAccountSchema` |
| `apps/api/src/modules/security/security.service.ts` | OTP issue/verify, rate limiting, self-lock |
| `apps/api/src/modules/security/security.controller.ts` | `POST hosts/me/security/otp/challenge` |
| `apps/api/src/modules/payments/providers/payment-provider.interface.ts` | `disburse`, `refund`, `reserveAccount`, `listBanks`, `resolveBankAccount` — the disbursement half of the provider contract |
| `apps/api/src/modules/payments/services/refund-webhook.service.ts` | `RefundWebhookService.reconcile()` — `SUCCESSFUL_REFUND`/`FAILED_REFUND` reconciliation |
| `apps/api/src/modules/payments/services/reserved-account-webhook.service.ts` | `ReservedAccountWebhookService.reconcile()` — `RESERVED_ACCOUNT_TRANSACTION` reconciliation into `wallet_topups` + `wallet_ledger` |
| `apps/api/src/config/configuration.ts` | `monnify.useRefundApi` / `monnify.useReservedAccountApi` — the rollout flags |
| `packages/shared-types/src/payment.ts` | `Payout`, `PayoutStatus` types |
| `packages/shared-types/src/wallet-ledger.ts` | Ledger entry types shared with the frontend |

## What's not built yet

- **Wallet-balance pre-flight check** before disbursing, so an under-funded platform disbursement wallet fails with a clean message instead of a raw Monnify 4xx.
- **Disbursement status polling for payouts** — today any non-`failed` initial response from `disburse()` is treated as final; Monnify can settle asynchronously. (Refunds no longer have this gap once `MONNIFY_USE_REFUND_API` is on: the dedicated refund API's `SUCCESSFUL_REFUND`/`FAILED_REFUND` webhooks resolve a `processing` refund for real — see [Refund-webhook reconciliation](#refund-webhook-reconciliation) above. Payouts still lack an equivalent poller/webhook.)
- **Reserved-account webhook field names unverified** — `RESERVED_ACCOUNT_TRANSACTION`'s `eventData` shape (particularly `product.reference`) in `parseReservedAccountWebhook()` is inferred from Monnify's docs, not a captured real payload. Smoke-test against sandbox and adjust field names if they differ before flipping `MONNIFY_USE_RESERVED_ACCOUNT_API` on in production.
- **Reserved-account retry-with-same-reference behavior unconfirmed** — whether a retried `reserveAccount()` call after a partial failure (e.g. Monnify succeeded but our DB write didn't) upserts the existing reserved account or errors on a duplicate `accountReference` isn't covered by the docs sample this integration was built from — worth a sandbox smoke test.

## Related

- [The wallet ledger](wallet-ledger.md) — the hash-chained table both this doc's debits and payments' credits write through
- [Payments](payments.md) — the money-in side; `onSuccess` is the other writer into `wallet_ledger` (a `credit`, `sourceType: "payment_transaction"`)
- [Booking flow](booking-flow.md) — where the wallet credit fits in the checkout sequence
- [Monnify API usage](../guides/monnify-apis-usage.md) — the `disburse`/bank-list/resolve endpoints this doc's flows call
