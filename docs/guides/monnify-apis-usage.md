# Monnify API — endpoints we use

Audit of every Monnify endpoint bookmi's backend calls today, the code
path that owns it, the domain data it produces, and what we _don't_ use
yet but should.

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
| 3 | GET | `/api/v2/merchant/transactions/query?paymentReference=…` | `verify()` | `PaymentsService.verify` (client after popup close) and the webhook receipt path | Read the terminal state of a transaction. Idempotent. |
| 4 | GET | `/api/v1/banks` | `listBanks()` | `HostWalletService.listBanks` (24h in-mem cache) | Populate the bank dropdown in Profile → Payout Details and RefundModal. |
| 5 | GET | `/api/v1/disbursements/account/validate?accountNumber=…&bankCode=…` | `resolveBankAccount()` | `HostWalletService.savePayoutAccount` (before write), `HostBookingsService.refundBooking` (before disburse), the RefundModal + PayoutSection frontend (auto-verify on typing) | Name enquiry — resolve `{ bankCode, accountNumber }` to the bank-canonical account name. Rejects invalid combos before we spend money. |
| 6 | POST | `/api/v2/disbursements/single` | `disburse()` | `HostBookingsService.refundBooking` today; host payout endpoint uses the same call shortly | Send funds from `MONNIFY_DISBURSEMENT_WALLET` to a Nigerian bank account. Same code path for refunds AND host withdrawals — different `destinationBankCode/AccountNumber` inputs. |

### Webhook (inbound)

Endpoint: `POST /api/payments/webhook/monnify` on our side (`payments-webhook.controller.ts`).
Signature: `monnify-signature` header, HMAC-SHA512 of the raw body with
`MONNIFY_WEBHOOK_SECRET`. Verified inside `MonnifyProvider.verifyWebhookSignature`.

Events we recognize today (in `parseWebhook`):

| Monnify event | Domain effect |
|---|---|
| `SUCCESSFUL_TRANSACTION` | Maps `paymentReference` to a `payment_transactions` row and calls `finalize()` → BookingCheckoutHandler.onSuccess → booking confirmed + wallet credited + emails enqueued. |
| any other `eventType` | Ingested into `payment_webhook_events` (dedup by `providerEventId`) but not otherwise processed. |

## Environment variables

| Var | Read from | Purpose |
|---|---|---|
| `MONNIFY_BASE_URL` | `configuration.ts` → `monnify.baseUrl` | Sandbox vs prod switch. |
| `MONNIFY_API_KEY` | `monnify.apiKey` | Half of the Basic auth for `/api/v1/auth/login`. Frontend also reads a *publishable* copy as `VITE_MONNIFY_API_KEY` for the popup SDK. |
| `MONNIFY_SECRET_KEY` | `monnify.secretKey` | Other half of Basic auth. Also the HMAC key for webhook signatures. **Never send to the frontend.** |
| `MONNIFY_CONTRACT_CODE` | `monnify.contractCode` | Required for `init-transaction`. Also read by the frontend as `VITE_MONNIFY_CONTRACT_CODE` for the popup SDK. |
| `MONNIFY_WEBHOOK_SECRET` | `monnify.webhookSecret` | HMAC key for signature verification. Typically the same as `MONNIFY_SECRET_KEY` in sandbox. |
| `MONNIFY_DISBURSEMENT_WALLET` | `monnify.disbursementWallet` | Merchant's disbursement wallet number — the `sourceAccountNumber` on every disburse call. Backs both refunds and host payouts. |

## Not in use yet — gaps to close

Prioritized by how much they'd tighten money-out safety, then by
feature reach.

### 1. Wallet balance (pre-flight check)

- **GET** `/api/v2/disbursements/wallet-balance`
- Response has `availableBalance` (kobo)
- **Should call before** every refund + payout intent to fail fast if the platform's disbursement wallet doesn't have enough. Right now if `MONNIFY_DISBURSEMENT_WALLET` is under-funded, the disburse call itself 4xx's — the user sees a generic Monnify error instead of a clean "insufficient platform balance" message.
- **Add**: `PaymentProvider.getDisbursementBalance?(): Promise<{ availableKobo }>` + Monnify implementation. Call from `refundBooking` and (upcoming) `withdraw` right after loading the booking / wallet row and before the OTP challenge.

### 2. Disbursement summary (poll status)

- **GET** `/api/v2/disbursements/single/summary?reference=…`
- Response returns the current state of a previously-initiated disbursement.
- We already have a `refunds.monnify_reference` and (soon) `payouts.monnify_reference`. Today we treat any non-`failed` status returned by the initial `disburse` call as final. Reality: Monnify often returns `PENDING` first and confirms later via webhook.
- **Add**: `PaymentProvider.pollDisbursement?(providerReference)` + a cron/interval that walks unresolved refund + payout rows until they hit a terminal state. Bookmi's `payment_transactions` finalize path already does the equivalent for checkouts.

### 3. Disbursement OTP validate + resend (Monnify's own MFA)

- **POST** `/api/v2/disbursements/single/validate-otp`
- **POST** `/api/v2/disbursements/single/resend-otp`
- Monnify wallets in the default state require an OTP for every single disbursement — you initiate the disburse, they hold it in `PENDING_AUTHORIZATION`, email an OTP to the wallet admin, you POST it back to validate.
- Prod best practice: **have Monnify disable MFA on the disbursement wallet** so programmatic disbursements land immediately (Monnify support does this on request for merchants with server-side controls). Bookmi is providing its own OTP 2FA on top of the host action, so double-MFA is friction with no benefit.
- **If MFA stays on**: expose `PaymentProvider.validateDisbursementOtp` + `resendDisbursementOtp`. The refund/payout flow becomes multi-step: initiate → hold row in `pending_authorization` → operator (or bookmi admin) forwards Monnify's OTP → validate → row flips to `processing`.
- Recommendation: request MFA disable in prod. Skip these endpoints for MVP.

### 4. Dedicated refund endpoints

- **POST** `/api/v1/refunds/initiate-refund`
- **GET** `/api/v1/refunds/{reference}`
- Bookmi currently refunds via `disburse` — semantically we're sending money to the customer's bank the same way we'd pay a host. Monnify's refund endpoint is subtly different:
  - Doesn't need `sourceAccountNumber` — pulls from the settled portion of the original transaction.
  - Preserves the refund→original-transaction link on the Monnify side (nice for their dashboard + your reconciliation).
  - Some rails (card, direct debit) support refund but not disbursement.
- **Recommendation**: for the MVP demo, keep the current disburse-based refund because it also handles refunds where the destination bank differs from the original card issuer (a real user case — customer used a friend's card, refund needs to go to their own bank). Add the real refund endpoint later as `PaymentProvider.refund` (already reserved as an optional method in the interface), and use it when `destinationBank == originalCardIssuer`. Falls back to `disburse` otherwise.

### 5. Reserved accounts (inbound bank transfer per host)

- **POST** `/api/v2/bank-transfer/reserved-accounts`
- **GET** `/api/v2/bank-transfer/reserved-accounts/{ref}`
- Provision a virtual NUBAN account tied to a host. Customers can wire money to it and the funds land in the host's shadow wallet — no card/USSD friction, no Monnify popup, no fees.
- Amendment plan task 52-a — the Wallet page's "Your reserved account" card already exists as UI, gated on `wallet.reservedAccountNumber`. Provisioning is unbuilt.
- **Add**: `PaymentProvider.createReservedAccount` + Monnify implementation + `WalletService.provisionReservedAccount(hostId)` called from `HostProfileService.createForUser` after the wallet row insert. Webhook path needs a new event type: `SUCCESSFUL_TRANSACTION` with `product.type = "RESERVED_ACCOUNT"` → credit host wallet + insert into a new `wallet_deposits` table.

## Interface anchor

Every endpoint above lives behind an optional method on
`apps/api/src/modules/payments/providers/payment-provider.interface.ts`.
Adding a Paystack/Flutterwave adapter later just implements the methods
each provider supports and leaves the rest undefined — the orchestrator
already checks with `if (!provider.method)` before calling.

## Related reading

- Bookmi's own architecture: `docs/architecture/payments.md`
- Monnify official API index: <https://developers.monnify.com>
- Webhook signing + retry semantics: `docs/guides/webhook-testing.md` (to be added)
