# Webhook signing + retry semantics

How Monnify's webhook lands, how to test it locally, and what bookmi guarantees around retries and duplicates.

## Endpoint

`POST /api/payments/webhook/:provider` (e.g. `/api/payments/webhook/monnify`) — `apps/api/src/modules/payments/controllers/payments-webhook.controller.ts`.

- **Public** (`@Public()`, no JWT). The HMAC signature *is* the authentication — a JWT-guarded webhook URL is a broken webhook URL, since the provider can't obtain a bookmi session token.
- Requires the **raw request body** as a `Buffer` (`req.rawBody`, enabled via `rawBody: true` on `NestFactory.create` in `main.ts`) — signature verification is over the exact bytes Monnify sent, not a re-serialized JSON object, since re-serialization can reorder keys or change whitespace and break the HMAC.

## Signature verification

- Header: `monnify-signature`.
- Algorithm: HMAC-SHA512 of the raw body, keyed with `MONNIFY_WEBHOOK_SECRET`, hex-encoded.
- Comparison is **case-insensitive** — Monnify's own docs and dashboard examples mix upper/lowercase hex, so a case-sensitive compare produces intermittent false negatives.
- Implemented in `MonnifyProvider.verifyWebhookSignature` (`apps/api/src/modules/payments/providers/monnify.provider.ts`).

If the signature doesn't verify, the request is rejected before touching any domain data.

## Idempotency at the edge

Before anything else runs, `processWebhook` inserts into `bookmi.payment_webhook_events` keyed on `(provider_code, provider_event_id)` — UNIQUE together. A duplicate insert throws Postgres `23505`; the handler looks up the existing row, confirms it's already processed, and returns `200` without re-running any side effect.

**Why this matters for testing**: replaying the exact same webhook payload twice (same `provider_event_id`) is safe and expected to no-op the second time — that's the behavior to assert, not a bug.

## Retries

Providers retry webhooks on any non-2xx response — Monnify retries roughly 6 times with backoff. bookmi's controller always returns `200` for anything it handled **or safely ignored** (duplicate event, unknown reference), so the provider stops retrying once we've seen it once. Only a genuine crash (5xx) should trigger a provider retry.

## Testing locally

Local dev has no public URL for Monnify's sandbox to call back to. Two options:

### Option 1 — ngrok tunnel (recommended for end-to-end testing)

```bash
ngrok http 4000
```

1. Copy the `https://<random>.ngrok-free.app` URL ngrok prints.
2. In the Monnify sandbox dashboard, set your webhook URL to `https://<random>.ngrok-free.app/api/payments/webhook/monnify`.
3. Run a real sandbox checkout through the app — the popup flow in [local development](local-development.md#the-full-demo-flow) — and watch the API logs for the incoming webhook.
4. `ngrok`'s local web UI (`http://127.0.0.1:4040`) shows every request/response, useful for inspecting the exact payload Monnify sent if something doesn't verify.

Same trick as the Monnify popup's sandbox-origin workaround mentioned in [local development troubleshooting](local-development.md#troubleshooting) — you likely already have ngrok running for that; reuse the same tunnel for the webhook URL.

### Option 2 — smee.io channel

An alternative to ngrok that doesn't require an installed tunneling binary — useful if you want a stable, shareable webhook URL across restarts (an ngrok tunnel's URL changes every run on the free tier; a smee.io channel URL is fixed once created).

1. Open [smee.io](https://smee.io) and click **Start a new channel**. Copy the channel URL it gives you (`https://smee.io/<random-id>`).
2. Point Monnify's sandbox webhook URL at that channel URL directly.
3. Relay it to your local API with the `smee-client` CLI:
   ```bash
   npx smee-client -u https://smee.io/<random-id> -t http://localhost:4000/api/payments/webhook/monnify
   ```
4. Run a real sandbox checkout through the app, same as the ngrok flow above.

smee.io's own page for the channel shows a live log of every payload it relays — a browser-based alternative to ngrok's local `:4040` inspector, handy if you want to share what a webhook payload actually looked like with someone else without them needing access to your machine.

### Option 3 — replay a captured payload with curl

Useful for testing idempotency/retry handling without waiting on a real Monnify event:

```bash
BODY='{"eventType":"SUCCESSFUL_TRANSACTION", "eventData": { ... } }'
SECRET=<your MONNIFY_WEBHOOK_SECRET>
SIGNATURE=$(echo -n "$BODY" | openssl dgst -sha512 -hmac "$SECRET" -hex | sed 's/^.* //')

curl -X POST http://localhost:4000/api/payments/webhook/monnify \
  -H "Content-Type: application/json" \
  -H "monnify-signature: $SIGNATURE" \
  --data-raw "$BODY"
```

Run it twice with the same `eventData.transactionReference`/event id to confirm the second call returns `200` with no duplicate side effects (no second email, no double wallet credit) — that's the dedup path doing its job.

## What happens per event type

| Monnify `eventType` | Domain effect |
|---|---|
| `SUCCESSFUL_TRANSACTION` | Maps `paymentReference` to a `payment_transactions` row, calls `PaymentsService.finalize()` → advisory lock → status transition → `BookingCheckoutHandler.onSuccess` (booking confirmed, wallet ledger credited, emails sent). See [Booking flow](../architecture/booking-flow.md) and [Payments](../architecture/payments.md#the-finalize-path). |
| Anything else | Ingested into `payment_webhook_events` for dedup bookkeeping but not otherwise processed today. |

## Related

- [Payments](../architecture/payments.md#the-finalize-path) — the finalize path this webhook feeds into
- [Monnify API usage](monnify-apis-usage.md) — every other Monnify endpoint bookmi calls
- [Booking flow](../architecture/booking-flow.md) — the "idempotent webhook edge" invariant in context
