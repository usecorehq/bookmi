# Bookmi — by Qorelly

> A shareable link where anyone can browse your services and book + pay in one flow. Money lands in your Monnify-powered wallet; withdraw to your bank anytime.

**Buy Me a Coffee, but for booking paid services in Nigeria** — powered by Monnify.

- **Hosts** sign up, claim a slug (`book.me/<slug>`), list services, share the link.
- **Customers** open the slug, pick services + a time, pay through the Monnify popup.
- **Bookmi** pockets a small platform fee; the rest credits the host's Monnify-backed wallet, ready to withdraw to any Nigerian bank account.

---

## Stack at a glance

| Layer | Tech |
|---|---|
| Frontend | Vite + React 18, Tailwind (Square/Revolut inspired sharp cards, pill buttons, `#7856FF` violet), TanStack Query, `@supabase/supabase-js` |
| Backend | NestJS 11, drizzle-orm on `postgres.js`, Zod DTOs via `nestjs-zod`, Swagger at `/docs` |
| DB | Single Supabase Postgres (local self-host or cloud), all app tables live under the `bookmi` schema |
| Auth | Supabase Auth (email + OAuth). Backend verifies JWTs (HS256 or ES256 JWKS), with `audience: authenticated` enforced |
| Payments | Provider-agnostic `PaymentProvider` interface. Monnify adapter today; Paystack/Flutterwave slot in later without touching the orchestrator |
| Emails | React Email templates + `@nestjs-modules/mailer` (SMTP). Mailhog in dev, Resend/SES/Mailgun via SMTP relay in prod. Live preview at `pnpm email:dev` |
| Money accounting | Three-table pattern for payments-in: `payment_transactions` (state machine), `payment_events` (append-only audit), `payment_webhook_events` (edge-level dedup). Wallet balance itself is backed by `wallet_ledger`, an immutable hash-chained ledger both booking credits and host payouts/refunds write through |

---

## Quick start

**Prerequisites:** Node ≥ 20.19, pnpm ≥ 10, Docker (for Mailhog + optionally Supabase), a running local Supabase (see [self-host guide](docs/guides/supabase-self-host.md)) or a [cloud Supabase project](docs/guides/supabase-cloud.md).

```bash
# 1. Clone + install
git clone https://github.com/<you>/bookmi.git
cd bookmi
pnpm install

# 2. Copy env samples
cp .env.example apps/api/.env
cp .env.example apps/web/.env

# 3. Fill in Supabase + Monnify keys — details in the guide
# See docs/guides/local-development.md

# 4. Run migrations + seed
pnpm --filter @bookmi/api db:migrate
pnpm --filter @bookmi/api db:seed

# 5. Start Mailhog (optional but recommended in dev)
docker compose -f docker/docker-compose.yml up -d mailhog
# SMTP :1025, web preview at http://localhost:8025

# 6. Boot both apps
pnpm dev
```

Once up:

| URL | What |
|---|---|
| http://localhost:5173 | Web app (Vite dev server) |
| http://localhost:4000/api/health | Backend health check |
| http://localhost:4000/docs | Swagger UI — paste a Supabase access token to hit protected endpoints |
| http://localhost:3010 | `pnpm --filter @bookmi/api email:dev` — live template preview |
| http://localhost:8025 | Mailhog captured emails |

Full walkthrough: **[docs/guides/local-development.md](docs/guides/local-development.md)**.

---

## Monorepo layout

```
apps/
  api/                NestJS + drizzle. Modules: auth, health, hosts, payments,
                      emails. Migrations at src/drizzle/migrations/.
  web/                Vite + React + Tailwind. Pages: auth/, onboarding/,
                      dashboard/, public/. Shared context: AuthContext.
packages/
  shared-types/       TS types shared between web + api (Booking, HostProfile,
                      PaymentTransaction, etc.). All monetary values in kobo.
  tsconfig/           Base tsconfig — node.json, react.json, base.json.
docs/
  architecture/       Why we made the choices we made.
  guides/             How to run + deploy.
docker/
  docker-compose.yml  Mailhog for local SMTP capture.
turbo.json            Task pipeline (dev / build / test / typecheck).
pnpm-workspace.yaml   Workspace packages.
```

---

## Documentation

Everything worth understanding lives under [`docs/`](docs/README.md). The critical reads:

### Architecture — why we built it this way

- **[Payment provider abstraction](docs/architecture/payments.md)** — Interface, registry, state machine, purpose handler pattern. Adding a new provider is one file.
- **[The wallet ledger](docs/architecture/wallet-ledger.md)** — The hash-chained, tamper-evident table backing every wallet balance change.
- **[Payouts and refunds](docs/architecture/payouts.md)** — OTP-gated host withdrawals and customer refunds, both writing through the ledger above.
- **[Email sending](docs/architecture/emails.md)** — React Email templates, provider abstraction, preview server, why we send inline (for now) and the queue upgrade path.
- **[Booking flow, end-to-end](docs/architecture/booking-flow.md)** — Full sequence diagram from signup through paid booking, including how we handle payment races, popup closures, and webhook lag.

### Guides — how to run + deploy

- **[Local development](docs/guides/local-development.md)** — Full setup with commands.
- **[Self-hosted Supabase](docs/guides/supabase-self-host.md)** — Running Supabase locally in Docker and wiring bookmi to it.
- **[Cloud Supabase](docs/guides/supabase-cloud.md)** — Getting your project up on supabase.com and grabbing the env vars.
- **[Deploy backend](docs/guides/deploy-backend.md)** — Coolify, Digital Ocean App Platform, plain Docker.
- **[Deploy frontend](docs/guides/deploy-frontend.md)** — Vercel, Netlify, Firebase Hosting, Cloudflare Pages.

---

## Common commands

```bash
# Dev
pnpm dev                              # turbo: run every workspace's dev
pnpm --filter @bookmi/api dev         # just the API
pnpm --filter @bookmi/web dev         # just the web

# Testing (backend)
pnpm --filter @bookmi/api test        # runs unit + int + e2e in sequence
pnpm --filter @bookmi/api test:unit
pnpm --filter @bookmi/api test:int    # Testcontainers Postgres
pnpm --filter @bookmi/api test:e2e

# Database
pnpm --filter @bookmi/api db:generate --name=<what_changed>
pnpm --filter @bookmi/api db:migrate
pnpm --filter @bookmi/api db:seed
pnpm --filter @bookmi/api db:studio   # drizzle-kit's inspector

# Emails
pnpm --filter @bookmi/api email:dev   # react-email preview @ :3010

# Build
pnpm build                            # every workspace
pnpm --filter @bookmi/api build
pnpm --filter @bookmi/web build
```

---

## License

Proprietary (Qorelly) — see [LICENSE.md](LICENSE.md). Non-commercial reading and hackathon-review use permitted; everything else is reserved. Maintainers and contact info are in the license file.