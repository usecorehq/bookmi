# Monnify API — endpoints we use

Audit of every Monnify endpoint bookmi's backend calls today, the code
path that owns it, and the domain data it produces. This doc tracks
what's actually wired up — not a wishlist of endpoints we might add later.
Grouped by product area rather than call order, since that's how you'll
actually go looking for something.

Base URL: `MONNIFY_BASE_URL` (sandbox: `https://sandbox.monnify.com`,
prod: `https://api.monnify.com`).
Auth: HTTP Basic `apiKey:secretKey` on `POST /api/v1/auth/login` →
bearer token cached in-process (`monnify.provider.ts`, `tokenCache`
field, ~1h TTL with a 60s safety buffer). Every other call below sends
that token in `Authorization: Bearer …`. Every endpoint has a single
caller in `apps/api/src/modules/payments/providers/monnify.provider.ts`
— the `PaymentProvider` interface owns the shape; the orchestrator
(`payments.service.ts`, `host-wallet.service.ts`, `host-bookings.service.ts`,
`paycode.service.ts`) speaks to the interface, not Monnify directly.

## Checkout API — booking payment

| Method | Endpoint | Provider method | Called by | Purpose |
|---|---|---|---|---|
| POST | `/api/v1/merchant/transactions/init-transaction` | `initialize()` (only when `metadata.checkout_mode === 'checkout_url'`) | `PaymentsService.initiate` | Create a hosted checkout URL. Popup flow bypasses this and echoes the reference straight back. |
| GET | `/api/v2/merchant/transactions/query?paymentReference=…` | `verify()` | `PaymentsService.verify` (client after popup close) and the webhook receipt path | Read the terminal state of a booking payment transaction. Idempotent. Monnify's own `transactionReference` is persisted to `payment_transactions.provider_transaction_id` — required input for the dedicated refund endpoint below. |

## Customer Reserved Account — static wallet for host

| Method | Endpoint | Provider method | Called by | Purpose |
|---|---|---|---|---|
| POST | `/api/v2/bank-transfer/reserved-accounts` ([docs](https://developers.monnify.com/docs/collections/recurring-payments/reserved-accounts)) | `reserveAccount()` | `HostWalletService.activateReservedAccount`, only when `monnify.useReservedAccountApi` is `true` | Provision a reserved/dedicated virtual account for a host — a static bank account number customers can transfer into to fund the host's wallet. `accountReference` = bookmi's `host.id`, the correlator the reserved-account-credit webhook uses to map a transfer back to a host with no side-table lookup (whether it's also an upsert key on retry is unconfirmed — see below). Requires `accountName`, `customerEmail`, `customerName`, `bvn`. Either `preferredBanks` (via `MONNIFY_RESERVED_ACCOUNT_BANK_CODE`) or `getAllAvailableBanks: true` (default). Every bank Monnify returns is persisted to `reserved_bank_accounts`, with the first marked active. Gated behind `MONNIFY_USE_RESERVED_ACCOUNT_API` / `monnify.useReservedAccountApi` (default `false`) — flip on after a sandbox smoke test of the retry-with-same-reference behavior. |

## Refunds — refund when a service is cancelled

| Method | Endpoint | Provider method | Called by | Purpose |
|---|---|---|---|---|
| POST | `/api/v1/refunds/initiate-refund` | `refund()` | `HostBookingsService.refundBooking`, only when `monnify.useRefundApi` is `true` | Dedicated refund against the original transaction. Requires `transactionReference` (Monnify's reference for the original transaction, from `payment_transactions.provider_transaction_id`), `refundReference` (bookmi's deterministic `refund_<id>`), and `refundReason` (truncated to 64 chars). Optional: `refundAmount`, `customerNote` (truncated to 16 chars), and `destinationAccountNumber`/`destinationAccountBankCode` for the host-chosen destination bank. Gated behind `MONNIFY_USE_REFUND_API` / `monnify.useRefundApi` (default `false`) — flip on after a sandbox smoke test. |
| POST | `/api/v2/disbursements/single` | `disburse()` | `HostBookingsService.refundBooking`, when `monnify.useRefundApi` is `false` (the default) | Fallback path for refunds — same generic transfer API host payouts use, kept as the no-breaking-changes default until the dedicated refund API above is smoke-tested. |

## Single/Bulk Transfer — payout/withdrawal to host

| Method | Endpoint | Provider method | Called by | Purpose |
|---|---|---|---|---|
| POST | `/api/v2/disbursements/single` | `disburse()` | Host payout endpoint (`HostWalletService.withdraw`), unconditionally | Send funds from `MONNIFY_DISBURSEMENT_WALLET` to a Nigerian bank account. Always used for host withdrawals. |

Bulk transfer (`POST /api/v2/disbursements/batch`) is **not implemented** — every disbursement today is single-transfer, whether it's a withdrawal or (on the fallback path) a refund.

## Paycode API — offline payout

Hosts who need cash but have no ATM card, or who are in a low-connectivity area, can generate a **paycode** — a code redeemable for cash at any Moniepoint POS agent instead of a bank transfer. See [Payouts and refunds → Paycodes](../architecture/payouts.md#paycodes-offline-payout) for the full create/cancel/expire/reveal flow.

| Method | Endpoint | Provider method | Called by | Purpose |
|---|---|---|---|---|
| POST | `/api/v1/paycode` | `createPaycode()` | `PaycodeService.createPaycode` | Generate a paycode for a given amount. `clientId` = `monnify.apiKey`; `expiryDate` formatted `YYYY-MM-DD HH:MM:SS`. Returns `paycode` (masked), `transactionReference`, `fee`, `transactionStatus: PENDING`. |
| GET | `/api/v1/paycode` | `fetchPaycodes()` | Not called by any bookmi flow today — implemented on the provider for completeness, unwired | History of generated paycodes over a period (`transactionReference`/`beneficiaryName`/`transactionStatus`/`from`/`to` unix-seconds query params), paginated. |
| GET | `/api/v1/paycode/{paycodeReference}` | `getPaycode()` | `PaycodeService`'s lazy + scheduled-sweep expiry reconciliation | Masked paycode lookup — used to confirm true status (e.g. "already redeemed") before assuming expiry. |
| DELETE | `/api/v1/paycode/{paycodeReference}` | `cancelPaycode()` | `PaycodeService.cancelPaycode` | Cancel a pending paycode. The wallet hold is credited back regardless of whether the live API or the mock path is active. |
| GET | `/api/v1/paycode/{paycodeReference}/authorize` | `getClearPaycode()` | `PaycodeService.revealPaycode` | Unmasked paycode — the actual redeemable digits. Never persisted; fetched live on every reveal. Gated by its own OTP purpose (`reveal_paycode`), distinct from the one that gated creation. |

Gated behind `MONNIFY_USE_PAYCODE_API` / `monnify.usePaycodeApi` (default `false`) — every deployment fabricates a mock paycode (deterministic 8-digit code derived from the paycode's own reference, never persisted) until this is set to `true` after a sandbox smoke test — same rollout-flag convention as refunds and reserved accounts.

**Open risk:** unlike every other group in this doc, Monnify's public docs don't show a worked webhook payload for paycode redemption/expiry — the `## Webhook (inbound)` row below is a best-guess heuristic, not confirmed. This doesn't block correctness: `PaycodeService` reconciles expiry itself (lazily on read, and every 5 minutes via a background sweep) rather than depending on a webhook arriving.

## Other — bank account KYC verification

| Method | Endpoint | Provider method | Called by | Purpose |
|---|---|---|---|---|
| GET | `/api/v1/banks` | `listBanks()` | `HostWalletService.listBanks` (24h in-mem cache) | Populate the bank dropdown in Profile → Payout Details and RefundModal. |
| GET | `/api/v1/disbursements/account/validate?accountNumber=…&bankCode=…` | `resolveBankAccount()` | `HostWalletService.savePayoutAccount` (before write), `HostBookingsService.refundBooking` (before disburse), the RefundModal + PayoutSection frontend (auto-verify on typing) | Name enquiry — resolve `{ bankCode, accountNumber }` to the bank-canonical account name for a host or customer supplied account. Rejects invalid combos before we spend money. |

### Webhook (inbound)

Endpoint: `POST /api/payments/webhook/monnify` on our side (`payments-webhook.controller.ts`).
Signature: `monnify-signature` header, HMAC-SHA512 of the raw body with
`MONNIFY_WEBHOOK_SECRET`. Verified inside `MonnifyProvider.verifyWebhookSignature`.

Events we recognize today (in `parseWebhook`):

| Monnify event | Domain effect |
|---|---|
| `SUCCESSFUL_TRANSACTION` | Maps `paymentReference` to a `payment_transactions` row and calls `finalize()` → BookingCheckoutHandler.onSuccess → booking confirmed + wallet credited + emails enqueued. |
| `SUCCESSFUL_REFUND` | Handled by `RefundWebhookService`. Matches the event to a `refunds` row and its `wallet_ledger` entry and reconciles both as completed. |
| `FAILED_REFUND` | Handled by `RefundWebhookService`. Marks the matching `refunds` row as failed and, if the refund had been optimistically marked pending, credits the wallet back via a compensating `wallet_ledger` entry. |
| `RESERVED_ACCOUNT_TRANSACTION` | Handled by `ReservedAccountWebhookService`. Resolves the host from `product.reference` (= `host.id`), records a `wallet_topups` row, and appends a `wallet_ledger` credit pointing at it — only reachable once a host has a real reserved account (`MONNIFY_USE_RESERVED_ACCOUNT_API=true`). |
| *(unconfirmed event name)* — routed heuristically by the presence of a `paycodeReference` field | Handled by `PaycodeWebhookService`, best-effort only. Not the correctness guarantee — `PaycodeService`'s lazy + 5-minute-sweep reconciliation is. Only reachable once `MONNIFY_USE_PAYCODE_API=true`. |
| any other `eventType` | Ingested into `payment_webhook_events` (dedup by `providerEventId`) but not otherwise processed. |

## Environment variables

| Var | Read from | Purpose |
|---|---|---|
| `MONNIFY_BASE_URL` | `configuration.ts` → `monnify.baseUrl` | Sandbox vs prod switch. |
| `MONNIFY_API_KEY` | `monnify.apiKey` | Half of the Basic auth for `/api/v1/auth/login`. Also the `clientId` sent on paycode creation. Frontend also reads a *publishable* copy as `VITE_MONNIFY_API_KEY` for the popup SDK. |
| `MONNIFY_SECRET_KEY` | `monnify.secretKey` | Other half of Basic auth. Also the HMAC key for webhook signatures. **Never send to the frontend.** |
| `MONNIFY_CONTRACT_CODE` | `monnify.contractCode` | Required for `init-transaction`. Also read by the frontend as `VITE_MONNIFY_CONTRACT_CODE` for the popup SDK. |
| `MONNIFY_WEBHOOK_SECRET` | `monnify.webhookSecret` | HMAC key for signature verification. Typically the same as `MONNIFY_SECRET_KEY` in sandbox. |
| `MONNIFY_DISBURSEMENT_WALLET` | `monnify.disbursementWallet` | Merchant's disbursement wallet number — the `sourceAccountNumber` on every disburse call. Backs both refunds (when the refund API flag is off) and host payouts. |
| `MONNIFY_USE_REFUND_API` | `monnify.useRefundApi` | Rollout flag for the dedicated refund endpoint. Defaults to `false`, so refunds keep going through `disburse()` exactly as before. |
| `MONNIFY_USE_RESERVED_ACCOUNT_API` | `monnify.useReservedAccountApi` | Rollout flag for the real reserved-account endpoint. Defaults to `false`, so `HostWalletService.activateReservedAccount` keeps fabricating a mock reserved account. |
| `MONNIFY_RESERVED_ACCOUNT_BANK_CODE` | `monnify.reservedAccountBankCode` | Optional — restricts reserved-account provisioning to a single partner bank code. Unset requests every partner bank Monnify supports and surfaces the first one returned. |
| `MONNIFY_USE_PAYCODE_API` | `monnify.usePaycodeApi` | Rollout flag for the real Paycode API. Defaults to `false`, so `PaycodeService` keeps fabricating a mock paycode. |
| `MONNIFY_PAYCODE_EXPIRY_HOURS` | `monnify.paycodeExpiryHours` | Hours a freshly-created paycode stays redeemable before the background sweep auto-expires it and credits the wallet back. Defaults to `24`. |

## Interface anchor

Every endpoint above lives behind an optional method on
`apps/api/src/modules/payments/providers/payment-provider.interface.ts`.
Adding a Paystack/Flutterwave adapter later just implements the methods
each provider supports and leaves the rest undefined — the orchestrator
already checks with `if (!provider.method)` before calling.

## Related reading

- Bookmi's own architecture: `docs/architecture/payments.md`, [`docs/architecture/payouts.md`](../architecture/payouts.md) (payouts, refunds, reserved accounts, paycodes, transactions statement)
- Monnify official API index: <https://developers.monnify.com>
- Webhook signing + retry semantics: [`docs/guides/webhook-testing.md`](webhook-testing.md)
