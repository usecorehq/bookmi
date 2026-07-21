# Architecture diagrams

Visual companion to the prose docs in [`docs/architecture/`](../architecture/). Each diagram is written as [Mermaid](https://mermaid.js.org/) source under [`mermaid/`](mermaid/) and rendered to SVG under [`images/`](images/). GitHub and VS Code (with the Mermaid preview extension) also render the `.mmd` source directly, so the source files are useful on their own.

## C4 model

| Diagram | Description |
|---|---|
| [`c4-context.svg`](images/c4-context.svg) ([source](mermaid/c4-context.mmd)) | System Context — Host and Customer actors, the Bookmi system, and external systems (Supabase Auth, Monnify, SMTP, Cloudinary). |
| [`c4-container.svg`](images/c4-container.svg) ([source](mermaid/c4-container.mmd)) | Container view — Web SPA, API, Postgres, Redis/BullMQ, and how they talk to each other and to external systems. |

## System overview

| Diagram | Description |
|---|---|
| [`system-flowchart.svg`](images/system-flowchart.svg) ([source](mermaid/system-flowchart.mmd)) | One high-level flowchart tying onboarding → booking → payment → wallet → payout together. Start here for the 10,000ft view. |

## Payment lifecycle

See [`docs/architecture/payments.md`](../architecture/payments.md) for the full prose write-up.

| Diagram | Description |
|---|---|
| [`payment-lifecycle-state.svg`](images/payment-lifecycle-state.svg) ([source](mermaid/payment-lifecycle-state.mmd)) | State diagram of `payment_transactions.status`: `pending → processing → {success, failed, abandoned}`, `success → reversed`. |
| [`payment-lifecycle-sequence.svg`](images/payment-lifecycle-sequence.svg) ([source](mermaid/payment-lifecycle-sequence.mmd)) | Sequence diagram of the provider-agnostic initiate/verify/webhook/finalize path, including the verify-vs-webhook race and webhook dedup. |

## Booking flow

See [`docs/architecture/booking-flow.md`](../architecture/booking-flow.md) for the full prose write-up (this diagram upgrades its ASCII sequence diagram).

| Diagram | Description |
|---|---|
| [`booking-flow.svg`](images/booking-flow.svg) ([source](mermaid/booking-flow.mmd)) | End-to-end sequence: customer browses a storefront, books, pays, and the booking is confirmed with the wallet credited. |

## Payout & wallet flow

See [`docs/architecture/payouts.md`](../architecture/payouts.md) and [`docs/architecture/wallet-ledger.md`](../architecture/wallet-ledger.md) for the full prose write-up.

| Diagram | Description |
|---|---|
| [`payout-flow.svg`](images/payout-flow.svg) ([source](mermaid/payout-flow.mmd)) | Sequence diagram of a host withdrawal (and, sharing the same shape, a refund): idempotent claim → OTP → advisory lock → disburse → ledger debit. |
| [`wallet-ledger-flow.svg`](images/wallet-ledger-flow.svg) ([source](mermaid/wallet-ledger-flow.mmd)) | Data-flow diagram of every writer into the hash-chained `wallet_ledger` table (booking credit, payout debit, refund debit, reserved-account top-up). |

## User journeys

| Diagram | Description |
|---|---|
| [`creator-journey.svg`](images/creator-journey.svg) ([source](mermaid/creator-journey.mmd)) | Host lifecycle: sign up → onboard → set up storefront → run the business → get paid. |
| [`audience-journey.svg`](images/audience-journey.svg) ([source](mermaid/audience-journey.mmd)) | Customer lifecycle: discover a storefront link → book → pay → confirmation. No account, ever. |
| [`onboarding-journey.svg`](images/onboarding-journey.svg) ([source](mermaid/onboarding-journey.mmd)) | Zoomed-in flowchart of signup + the onboarding wizard + first service live (branchy — email vs. OAuth, onboarded vs. not). |

## Regenerating a diagram

Edit the `.mmd` source in `mermaid/`, then re-render with [`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli) into `images/`:

```sh
npx -y @mermaid-js/mermaid-cli -i docs/diagrams/mermaid/<name>.mmd -o docs/diagrams/images/<name>.svg -b white
```

If `mmdc` can't launch a headless Chromium in your environment, pass a puppeteer config with `--no-sandbox`:

```sh
echo '{ "args": ["--no-sandbox"] }' > /tmp/mmdc-puppeteer-config.json
npx -y @mermaid-js/mermaid-cli -i docs/diagrams/mermaid/<name>.mmd -o docs/diagrams/images/<name>.svg -b white -p /tmp/mmdc-puppeteer-config.json
```
