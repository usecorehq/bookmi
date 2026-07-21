# Payments — provider-agnostic architecture

Bookmi processes money through a **provider abstraction**. Nothing in the orchestration layer knows Monnify exists. Adding Paystack, Flutterwave, or Stripe later is one file per provider plus a row in a routing table — the state machine, audit trail, and webhook handling stay identical.

## The three-table pattern

Every payment attempt writes to three tables.

### `bookmi.payment_transactions` — one row per attempt

The state machine and the money.

| Column | Purpose |
|---|---|
| `reference` (unique) | Bookmi-minted handle, prefix `bookmi_pmt_…`. Env-encoded (`dev-bookmi_pmt_…`) so shared sandbox webhooks route correctly. |
| `provider_code`, `provider_reference` | Which provider owns this attempt + the provider's own handle. UNIQUE index on `(provider_code, provider_reference)`. |
| `status` | State machine: `pending → processing → success / failed / abandoned / reversed`. `success → reversed` is the only allowed post-terminal transition. |
| `amount_minor`, `currency`, `fee_minor`, `net_amount_minor` | All in kobo. Currency for future non-NGN markets. |
| `purpose_type`, `purpose_id` | Why this payment exists (`booking_checkout` + booking id). |
| `initiator_user_id`, `idempotency_key` | Uniqueness enforced as `(initiator_user_id, idempotency_key)`. Same key from the same user replays the same row instead of double-charging. |
| `access_code`, `authorization_url` | Provider popup config. Persisted so an idempotent resume hands the client the same checkout intent. |
| `metadata` | JSONB. Channel filters, checkout mode (`popup` vs `checkout_url`), etc. ride here. |
| `initiated_at`, `provider_initiated_at`, `verified_at`, `webhook_received_at`, `completed_at` | Full lifecycle timeline for audits. |

### `bookmi.payment_events` — append-only audit

Every non-trivial thing that happens to a `payment_transactions` row lands here: `initiated`, `provider_response`, `verified`, `webhook_received`, `status_changed`, `error`, `purpose_handled`. Includes `from_status`/`to_status` and `source` (`client | admin | webhook | verify | system`). Rows are never updated or deleted.

### `bookmi.payment_webhook_events` — idempotency at the edge

The FIRST thing a webhook does is `INSERT INTO payment_webhook_events (provider_code, provider_event_id, signature, raw_payload)`. `(provider_code, provider_event_id)` is UNIQUE. A duplicate insert throws `23505` → the handler answers 200 without doing anything else. Provider retries a webhook 6 times? Only the first one settles anything.

## The `PaymentProvider` interface

Every provider adapter implements this. It lives at `apps/api/src/modules/payments/providers/payment-provider.interface.ts`:

```ts
interface PaymentProvider {
  readonly code: PaymentProviderCode;

  initialize(input: InitializeInput): Promise<InitializeResult>;
  verify(providerReference: string): Promise<VerifyResult>;
  verifyWebhookSignature(rawBody: Buffer, headers): boolean;
  parseWebhook(rawBody: Buffer, headers): ParsedWebhook;

  refund?(input: RefundInput): Promise<RefundResult>;
  chargeAuthorization?(input): Promise<VerifyResult>;
}
```

`RefundInput`/`RefundResult` back the dedicated refund flow — see [Payouts, refunds, and the wallet ledger](payouts.md#refunds).

All amounts are in **minor units** (kobo). All statuses come back **normalized** to the six-value bookmi enum. The orchestrator never sees provider dialect.

### The Monnify adapter

Lives at `apps/api/src/modules/payments/providers/monnify.provider.ts`. Handles:

- **Two initiate flows** picked by `metadata.checkout_mode`:
  - `popup` (default) — no server call; the frontend runs `monnify-js` directly with our reference. Provider `initialize` echoes the reference so the DB row picks up `providerReference = reference`.
  - `checkout_url` — POST `/api/v1/merchant/transactions/init-transaction`, returns `checkoutUrl` as `authorizationUrl` for the SPA to redirect into.
- **Token cache** — the `/api/v1/auth/login` bearer is cached with a 60s safety buffer.
- **Verify** — always by `paymentReference`, one code path for both flows.
- **Webhook signature** — HMAC-SHA512 hex, case-insensitive compare (Monnify's docs mix cases).
- **Amount conversion** — Monnify uses decimal strings (`"2500.00"`); we round-trip to integer kobo.
- **`paidOn` normalization** — Monnify sends two shapes (`yyyy-MM-dd HH:mm:ss.SSS` and `dd/mm/yyyy HH:mm:ss AM/PM`), both parsed as WAT and converted to UTC.

## The registry and country routing

Which provider handles a given transaction depends on **country + priority**. Rows in three small tables drive this:

- `countries` — ISO alpha-2 + default currency.
- `payment_providers` — one row per adapter (`monnify`, `paystack`, `flutterwave`, `stripe`).
- `country_payment_providers` — `(country_code, provider_code, priority, is_active)`. Priority 0 = primary. Fallbacks kick in only if the primary is `is_active = false`.

`PaymentProviderRegistry.resolveForCountry('NG')` reads these tables and returns the highest-priority active provider. **No code change to switch primary from Monnify to Paystack** — flip a row.

## The purpose handler pattern

`booking_checkout` is a *purpose*. Adding memberships, invoices, or coffee-tips means adding a new purpose, not touching the payment orchestrator.

A `PaymentPurposeHandler` (defined at `apps/api/src/modules/payments/purposes/purpose-handler.interface.ts`) owns:

- **`authorizeInitiate`** — is this initiator allowed to pay for this domain row? (BookingCheckoutHandler: does the service exist and is it active?)
- **`resolveInitiate`** — server-side price lock. The client-supplied amount is only trusted for free-form purposes. BookingCheckoutHandler sums `services.priceKobo` across `serviceIds`; any pay-what-you-want service makes the whole booking PWYW with the sum as the floor.
- **`onSuccess`** — the side effects. BookingCheckoutHandler flips the booking to `confirmed`, computes `platformFeeKobo`, and credits the host wallet by the net — via `WalletLedgerService.appendEntry` (a `credit`, `sourceType: "payment_transaction"`), not a direct `UPDATE host_wallets`, so the credit lands in the same hash-chained ledger that payouts debit from. See [The wallet ledger](wallet-ledger.md). Then fires two emails (best-effort, wrapped in try/catch).
- **`onFailure`** — mark the booking `failed`; no wallet mutation.
- **`onUnmatchedProviderEvent`** *(optional)* — handle events with no matching transaction (e.g. subscription-lifecycle events keyed by authorization). Every handler gets a chance to claim these; first-to-say-yes wins.

Handlers run **strictly after** the payments-DB commit. A handler failure is audited and logged but never unwinds a settled payment — that's the invariant.

## The finalize path

Both `verify` (client-triggered from the popup's `onSuccess`) and `processWebhook` route through `PaymentsService.finalize(txId, result)`. Inside a transaction:

1. **Advisory lock** on the transaction id — `SELECT pg_advisory_xact_lock(hashtextextended(txId, 0))`. Serializes concurrent verify + webhook attempts for the same tx.
2. **Reload current status** and short-circuit if we're already in a terminal state or the transition isn't allowed.
3. **Amount / currency mismatch guard** — provider reports success but the reported amount ≠ what we minted the tx for? Log an `error` event, refuse to transition. Never settle bad money.
4. **UPDATE tx** with the new status + timestamps + provider details.
5. **INSERT payment_events** row for the transition.
6. **Commit**, then dispatch the purpose handler outside the tx.

## Reference encoding for shared sandboxes

Every reference is prefixed with the environment that minted it:

```
prod        → bookmi_pmt_abc123…
dev         → dev-bookmi_pmt_abc123…
staging     → staging-bookmi_pmt_abc123…
sandbox     → sandbox-bookmi_pmt_abc123…
```

Providers give you ONE sandbox webhook URL per integration mode. When multiple environments share that mode, the webhook needs to know which one owns each event. bookmi encodes it in the reference. A production instance receiving a `dev-…` webhook can relay it to the dev instance byte-identical (qore-backend does this via `relayToEnvironment`; bookmi's MVP omits the relay path but the reference prefix is still there so we can add it in v1.1 without a data migration).

## What ships today, what's the upgrade path

**Today:**
- Monnify provider adapter (popup + hosted, verify, webhook signature, webhook parse).
- One purpose: `booking_checkout`.
- Full state machine + audit + edge-level dedup.
- Advisory locks around finalize.
- Amount-mismatch refusal.
- Emails on `onSuccess` (best-effort).

**Future without touching orchestration:**
- Add Paystack / Flutterwave / Stripe → new provider class + one row in `payment_providers`.
- Add memberships / tips / plan renewals → new purpose handler class.
- Multi-environment sandbox relay → uncomment `relayToEnvironment` in qore-backend and port over.

## Files

| File | What it holds |
|---|---|
| `apps/api/src/drizzle/schema.ts` | The three payment tables + routing tables |
| `apps/api/src/modules/payments/services/payments.service.ts` | Orchestrator (initiate, verify, processWebhook, finalize) |
| `apps/api/src/modules/payments/services/payment-state.ts` | Transition table |
| `apps/api/src/modules/payments/providers/payment-provider.interface.ts` | The contract |
| `apps/api/src/modules/payments/providers/payment-provider.registry.ts` | Country → provider lookup |
| `apps/api/src/modules/payments/providers/monnify.provider.ts` | Monnify adapter |
| `apps/api/src/modules/payments/purposes/purpose-handler.interface.ts` | Purpose contract |
| `apps/api/src/modules/payments/purposes/booking-checkout.handler.ts` | Booking → wallet credit + emails |
| `apps/api/src/modules/payments/payment-reference.ts` | Env-prefixed reference builder |
| `apps/api/test/integration/payments-flow.int-spec.ts` | 7 int tests against real Postgres |

## Related

- [Booking flow](booking-flow.md) — how the customer wizard talks to this
- [Emails](emails.md) — what `onSuccess` fires
- [The wallet ledger](wallet-ledger.md) — where the wallet credit actually lands
- [Payouts, refunds, and the wallet ledger](payouts.md) — how money later moves back out
