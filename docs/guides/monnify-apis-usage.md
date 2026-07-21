# Monnify API — endpoints we use

Audit of every Monnify endpoint bookmi's backend calls today, the code
path that owns it, and the domain data it produces. This doc tracks
what's actually wired up — not a wishlist of endpoints we might add later.

Base URL: `MONNIFY_BASE_URL` (sandbox: `https://sandbox.monnify.com`,
prod: `https://api.monnify.com`).
Auth: HTTP Basic `apiKey:secretKey` on the login endpoint → bearer token
cached in-process (`monnify.provider.ts`, `tokenCache` field). Every
other call sends the token in `Authorization: Bearer …`.

## In use today

Every endpoint below has a single caller in
`apps/api/src/modules/payments/providers/monnify.provider.ts` — the
`PaymentProvider` interface owns the shape; the orchestrator
(`payments.service.ts`, `host-wallet.service.ts`, `host-bookings.service.ts`)
speaks to the interface, not Monnify directly.

| # | Method | Endpoint | Provider method | Called by | Purpose |
|---|---|---|---|---|---|
| 1 | POST | `/api/v1/auth/login` | `getAccessToken()` | Every authed call | Exchange `apiKey:secretKey` for a ~1h bearer. Cached with a 60s safety margin. |
| 2 | POST | `/api/v1/merchant/transactions/init-transaction` | `initialize()` (only when `metadata.checkout_mode === 'checkout_url'`) | `PaymentsService.initiate` | Create a hosted checkout URL. Popup flow bypasses this and echoes the reference straight back. |
| 3 | GET | `/api/v2/merchant/transactions/query?paymentReference=…` | `verify()` | `PaymentsService.verify` (client after popup close) and the webhook receipt path | Read the terminal state of a transaction. Idempotent. Monnify's own `transactionReference` from the response is persisted to `payment_transactions.provider_transaction_id`, since bookmi previously only stored its own echoed reference — this is now required input for the dedicated refund endpoint below. |
| 4 | GET | `/api/v1/banks` | `listBanks()` | `HostWalletService.listBanks` (24h in-mem cache) | Populate the bank dropdown in Profile → Payout Details and RefundModal. |
| 5 | GET | `/api/v1/disbursements/account/validate?accountNumber=…&bankCode=…` | `resolveBankAccount()` | `HostWalletService.savePayoutAccount` (before write), `HostBookingsService.refundBooking` (before disburse), the RefundModal + PayoutSection frontend (auto-verify on typing) | Name enquiry — resolve `{ bankCode, accountNumber }` to the bank-canonical account name. Rejects invalid combos before we spend money. |
| 6 | POST | `/api/v2/disbursements/single` | `disburse()` | Host payout endpoint, unconditionally. `HostBookingsService.refundBooking` when `monnify.useRefundApi` is `false` (the default). | Send funds from `MONNIFY_DISBURSEMENT_WALLET` to a Nigerian bank account. Always used for host withdrawals; used for refunds only while the dedicated refund API is behind its rollout flag — a deliberate no-breaking-changes fallback, not a bug. |
| 7 | POST | `/api/v1/refunds/initiate-refund` | `refund()` | `HostBookingsService.refundBooking`, only when `monnify.useRefundApi` is `true` | Dedicated refund against the original transaction. Requires `transactionReference` (Monnify's reference for the original transaction, from `payment_transactions.provider_transaction_id`), `refundReference` (bookmi's deterministic `refund_<id>`), and `refundReason` (truncated to 64 chars). Optional: `refundAmount`, `customerNote` (truncated to 16 chars), and `destinationAccountNumber`/`destinationAccountBankCode` for the host-chosen destination bank. Gated behind `MONNIFY_USE_REFUND_API` / `monnify.useRefundApi` (default `false`) — flip on after a sandbox smoke test. |

### Webhook (inbound)

Endpoint: `POST /api/payments/webhook/monnify` on our side (`payments-webhook.controller.ts`).
Signature: `monnify-signature` header, HMAC-SHA512 of the raw body with
`MONNIFY_WEBHOOK_SECRET`. Verified inside `MonnifyProvider.verifyWebhookSignature`.

Events we recognize today (in `parseWebhook`):

| Monnify event | Domain effect |
|---|---|
| `SUCCESSFUL_TRANSACTION` | Maps `paymentReference` to a `payment_transactions` row and calls `finalize()` → BookingCheckoutHandler.onSuccess → booking confirmed + wallet credited + emails enqueued. |
| `SUCCESSFUL_REFUND` | Handled by `RefundWebhookService` (`apps/api/src/modules/payments/services/refund-webhook.service.ts`). Matches the event to a `refunds` row and its `wallet_ledger` entry and reconciles both as completed. |
| `FAILED_REFUND` | Handled by `RefundWebhookService`. Marks the matching `refunds` row as failed and, if the refund had been optimistically marked pending, credits the wallet back via a compensating `wallet_ledger` entry. |
| any other `eventType` | Ingested into `payment_webhook_events` (dedup by `providerEventId`) but not otherwise processed. |

## Environment variables

| Var | Read from | Purpose |
|---|---|---|
| `MONNIFY_BASE_URL` | `configuration.ts` → `monnify.baseUrl` | Sandbox vs prod switch. |
| `MONNIFY_API_KEY` | `monnify.apiKey` | Half of the Basic auth for `/api/v1/auth/login`. Frontend also reads a *publishable* copy as `VITE_MONNIFY_API_KEY` for the popup SDK. |
| `MONNIFY_SECRET_KEY` | `monnify.secretKey` | Other half of Basic auth. Also the HMAC key for webhook signatures. **Never send to the frontend.** |
| `MONNIFY_CONTRACT_CODE` | `monnify.contractCode` | Required for `init-transaction`. Also read by the frontend as `VITE_MONNIFY_CONTRACT_CODE` for the popup SDK. |
| `MONNIFY_WEBHOOK_SECRET` | `monnify.webhookSecret` | HMAC key for signature verification. Typically the same as `MONNIFY_SECRET_KEY` in sandbox. |
| `MONNIFY_DISBURSEMENT_WALLET` | `monnify.disbursementWallet` | Merchant's disbursement wallet number — the `sourceAccountNumber` on every disburse call. Backs both refunds (when the refund API flag is off) and host payouts. |
| `MONNIFY_USE_REFUND_API` | `monnify.useRefundApi` | Rollout flag for the dedicated refund endpoint. Defaults to `false`, so refunds keep going through `disburse()` exactly as before. Set to `true` (after a sandbox smoke test) to route `HostBookingsService.refundBooking` through `/api/v1/refunds/initiate-refund` instead. |

## Interface anchor

Every endpoint above lives behind an optional method on
`apps/api/src/modules/payments/providers/payment-provider.interface.ts`.
Adding a Paystack/Flutterwave adapter later just implements the methods
each provider supports and leaves the rest undefined — the orchestrator
already checks with `if (!provider.method)` before calling.

## Related reading

- Bookmi's own architecture: `docs/architecture/payments.md`
- Monnify official API index: <https://developers.monnify.com>
- Webhook signing + retry semantics: [`docs/guides/webhook-testing.md`](webhook-testing.md)
