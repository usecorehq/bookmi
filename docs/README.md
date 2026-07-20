# Bookmi docs

Everything about how Bookmi is built and how to run/deploy it.

## Architecture

Why we made the choices we made. Read these when you want to change something and need to know what's load-bearing.

- **[Payments](architecture/payments.md)** — Provider-agnostic `PaymentProvider` interface, registry, state machine, purpose-handler pattern. Adding a new provider is one file.
- **[Emails](architecture/emails.md)** — React Email templates + provider abstraction, preview server, why we send inline today, upgrade path to a queue.
- **[Booking flow](architecture/booking-flow.md)** — End-to-end sequence from signup through settled booking, including race handling, popup cancels, and webhook lag.

## Guides

How to actually run and deploy Bookmi.

### Setup

- **[Local development](guides/local-development.md)** — Full setup on your laptop.
- **[Self-hosted Supabase](guides/supabase-self-host.md)** — Running Supabase locally in Docker.
- **[Cloud Supabase](guides/supabase-cloud.md)** — supabase.com project + env vars.

### Deployment

- **[Deploy the backend](guides/deploy-backend.md)** — Coolify, Digital Ocean App Platform, plain Docker.
- **[Deploy the frontend](guides/deploy-frontend.md)** — Vercel, Netlify, Firebase Hosting, Cloudflare Pages.

## Contributing

Nothing formal yet. Follow existing patterns:

- Tests colocate with source (`*.spec.ts`) for unit tests; live in `test/integration/` or `test/e2e/` for the heavier tiers.
- Zod schemas for every DTO via `createZodDto` from `nestjs-zod`. Use `.strict()` on request bodies.
- All monetary values in **kobo** (1 NGN = 100). Never floats.
- Commit messages: conventional-commit style (`feat(scope): …`), imperative, no Agent co-author.
