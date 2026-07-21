# Booking flow — end to end

> Diagram: [booking flow sequence](../diagrams/images/booking-flow.svg)

The user-visible flow, from a fresh visitor to a settled booking, and everything the system does to keep it correct.

## Actors

- **Host** — the person selling services. Has a Supabase account, a `host_profiles` row (with a slug), a `host_wallets` row, and one or more `services` rows.
- **Customer** — anonymous. Never signs up. Enters name/email/phone at checkout.
- **Bookmi web** — Vite + React SPA.
- **Bookmi API** — NestJS. Verifies Supabase JWTs on host-side routes; leaves the customer checkout route public.
- **Monnify** — the payment provider.

## Happy path (10,000 ft)

```
1. Host signs up on Bookmi → verifies email → picks slug → adds services.
2. Host shares book.me/<slug>.
3. Customer opens the link, sees services, clicks "Book an appointment".
4. Customer picks services, picks a date + time, enters name/email/phone.
5. Customer clicks "Confirm booking · ₦X".
6. Monnify popup opens; customer pays with card / bank transfer / USSD.
7. Monnify calls back onComplete → frontend hits verify → API confirms.
8. Booking flips to confirmed; host wallet is credited (net of platform fee).
9. Two emails go out (host: "new booking"; customer: "you're booked").
10. Success screen shows the booking code, then auto-redirects to the host page after 60s.
```

## Detailed sequence

```
Customer         Web (BookingWizard)         API (public)         API (payments)      Monnify
   |                     |                       |                        |               |
   | click Book ────────>|                       |                        |               |
   |                     | GET /public/:slug     |                        |               |
   |                     |──────────────────────>| SELECT host + active   |               |
   |                     |                       |    services            |               |
   |                     |<──────────────────────|                        |               |
   |                     |                       |                        |               |
   |                     | GET /public/:slug/    |                        |               |
   |                     |   availability?date=  |                        |               |
   |                     |──────────────────────>| operating_hours JSONB  |               |
   |                     |                       | + existing bookings    |               |
   |                     |                       | → slot list            |               |
   |                     |<─── AvailabilitySlot[]|                        |               |
   |                     |                       |                        |               |
   | fills wizard ──────>|                       |                        |               |
   | click Confirm ─────>|                       |                        |               |
   |                     | POST /public/:slug/   |                        |               |
   |                     |   checkout            |                        |               |
   |                     |──────────────────────>| INSERT bookings        |               |
   |                     |                       |  status=pending        |               |
   |                     |                       |  code=<generated>      |               |
   |                     |                       |─────────────────────── >| PaymentsService.initiate
   |                     |                       |                        |  authorizeInitiate
   |                     |                       |                        |  resolveInitiate → amount lock
   |                     |                       |                        |  INSERT payment_transactions
   |                     |                       |                        |  provider.initialize (popup mode)
   |                     |                       |<─── { reference, ... } |               |
   |                     |<── { booking, payment }|                       |               |
   |                     |                       |                        |               |
   |                     | payWithMonnifyPopup ──────────────────────────────────────────>| open SDK
   | pays ──────────────>|                       |                        |               |
   |                     |                onComplete ← { reference }      |               |
   |                     |<──────────────────────────────────────────────────────────────|
   |                     |                       |                        |               |
   |                     | GET /payments/        |                        |               |
   |                     |   :reference/verify   |                        |               |
   |                     |─────────────────────────────────────────────── >| provider.verify
   |                     |                       |                        |  finalize:
   |                     |                       |                        |    advisory lock
   |                     |                       |                        |    UPDATE tx → success
   |                     |                       |                        |    INSERT payment_events
   |                     |                       |                        |  commit
   |                     |                       |                        |  handler.onSuccess:
   |                     |                       |                        |    UPDATE booking → confirmed
   |                     |                       |                        |    UPDATE wallet balance
   |                     |                       |                        |    emails.send() × 2
   |                     |<── { status: success }|                        |               |
   |                     |                       |<─── async webhook ────────────────────|
   |                     |                       |  (idempotent — no-op if confirmed)     |
   |<── SuccessScreen ───|                       |                        |               |
   |     (code + 60s     |                       |                        |               |
   |      countdown)     |                       |                        |               |
```

## Correctness invariants

The parts you should not break.

### 1. Booking is created BEFORE the payment initiate

`POST /public/:slug/checkout` inserts the `bookings` row with `status='pending'` **first**, then calls `PaymentsService.initiate` with `purposeType='booking_checkout'` and `purposeId=booking.id`.

`BookingCheckoutHandler.authorizeInitiate` refuses to initiate against a non-existent or non-pending booking. That's the guard against someone crafting a checkout for a booking they don't own.

### 2. Server-locked pricing

The customer submits a form; a malicious client could tamper with the amount. Bookmi ignores it.

`BookingCheckoutHandler.resolveInitiate` reads `services.priceKobo` for every service in `booking.serviceIds`, sums them, and uses that as the payment amount. The client-supplied `amountKobo` is only consulted when at least one selected service is `pay_what_you_want = true` — and even then it must be `>= sum(listed prices)`. Anything less throws 400.

### 3. Advisory lock around finalize

`verify` (client-triggered) and `processWebhook` (provider-triggered) can arrive **at the same time** for the same reference. Both call `PaymentsService.finalize(txId, result)`. The first line inside the DB transaction:

```sql
SELECT pg_advisory_xact_lock(hashtextextended(:txId, 0))
```

serializes them. The second one reads the fresh row, sees status is already `success`, and returns without doing anything. The purpose handler runs exactly once.

### 4. Idempotent webhook edge

Before doing anything expensive, `processWebhook` inserts a row into `payment_webhook_events` keyed on `(provider_code, provider_event_id)`. Both columns UNIQUE together. A duplicate insert throws `23505`; we look up the existing row, see it's already `processedAt IS NOT NULL`, and answer 200 without re-firing anything. Provider retries a webhook 6 times? Only the first one settles.

### 5. Amount / currency mismatch refusal

Providers occasionally report "success" with a different amount than what was minted (partial payment, currency conversion). `finalize` compares `result.amountMinor` and `result.currency` to the persisted values on the transaction row. If they disagree, it logs an `error` event to `payment_events` and **refuses to flip the row to success**. The booking stays pending; a human triages.

### 6. Emails are best-effort

Fired in `BookingCheckoutHandler.onSuccess` after the wallet credit **and outside the payment DB commit boundary**. Wrapped in try/catch. A Resend outage doesn't unwind the wallet credit.

### 7. Popup cancel is silent

If the customer closes the Monnify popup, the frontend gets `MonnifyPopupCancelled`. The wizard catches it and does nothing loud — no error toast, no scary message. The customer sees a "Retry payment" button that reopens the popup with the same reference (Monnify SDK allows reopen).

The booking row stays `pending`. The payment row stays `initialized`. Either the customer retries and settles it, or the host cancels the pending row from the dashboard later.

## The public checkout endpoint

`POST /api/public/:slug/checkout` is the only unauthenticated write endpoint in the whole API. It:

- Runs behind `@Public()` so the global JWT guard skips it.
- Body-validates via Zod (`.strict()` — unknown fields rejected).
- Wraps the booking insert + payment initiate in a Postgres transaction.
- Retries once on `40001` (serialization failure — two customers picking the same slot simultaneously).

## What the wizard sends

```json
POST /api/public/ada-bookings/checkout
{
  "serviceIds": ["…uuid…", "…uuid…"],
  "durationMinutes": 105,
  "slotStartAt": "2026-07-22T12:00:00.000Z",
  "customerName": "Aisha Bello",
  "customerEmail": "aisha@example.com",
  "customerPhone": "+2348012345678",
  "customerNotes": "Please call before arriving."
}
```

Response:

```json
{
  "booking": { "id": "…", "code": "X8-GAFJ" },
  "payment": {
    "reference": "dev-bookmi_pmt_…",
    "provider": "monnify",
    "amountMinor": 2700000,
    "currency": "NGN",
    "status": "pending",
    "accessCode": null,
    "authorizationUrl": null
  }
}
```

The frontend hands the whole `payment` object to `payWithMonnifyPopup(payment)`, which spins up the Monnify SDK. On `onComplete`, it hits `GET /api/payments/:reference/verify` and shows the SuccessScreen.

## What the customer sees on success

Screen layout is designed to feel *finished*, not just *sent*:

- Green checkmark, big.
- "Booking received!"
- One-line reassurance: "Thank you for choosing Serenity Demo Spa. We'll call {phone} shortly to confirm."
- The **booking code** as a giant monospaced string with a Copy button.
- A footer line: "This window will close automatically."
- A 60-second countdown then `Navigate` to `/<slug>`.

The host has already gotten their email by this point. The customer's email is on the way. Nobody loses track of the booking.

## Files

Frontend:

| File | What it holds |
|---|---|
| `apps/web/src/pages/public/HostPublicPage.tsx` | The public `/:slug` page |
| `apps/web/src/components/booking/BookingWizard.tsx` | 3-step wizard |
| `apps/web/src/components/booking/BookingSuccessScreen.tsx` | Post-payment landing |
| `apps/web/src/lib/paymentPopup.ts` | Provider dispatch |
| `apps/web/src/lib/monnifyPopup.ts` | Monnify SDK wrapper |

Backend:

| File | What it holds |
|---|---|
| `apps/api/src/modules/public/controllers/public-host.controller.ts` | `GET /:slug` + availability |
| `apps/api/src/modules/public/controllers/public-checkout.controller.ts` | `POST /:slug/checkout` |
| `apps/api/src/modules/public/services/availability.service.ts` | Slot generator |
| `apps/api/src/modules/public/services/checkout.service.ts` | Atomic booking + initiate |
| `apps/api/src/modules/payments/purposes/booking-checkout.handler.ts` | Wallet credit + emails |

## Related

- [Payments](payments.md) — the money layer under the flow
- [Emails](emails.md) — what the customer + host receive
