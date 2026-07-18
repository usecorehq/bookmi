# Bookmi — by Qorelly

> A shareable link where anyone can browse your services and book + pay in one flow. Money lands in your Monnify-powered wallet; withdraw to your bank anytime.

Think **Buy Me a Coffee, but for booking paid services in Nigeria** — powered by Monnify.

## Monorepo

```
apps/
  api/                NestJS + drizzle (Postgres via Supabase)
  web/                Vite + React + Tailwind + shadcn/ui
packages/
  shared-types/       Types shared between web and api
  tsconfig/           Base tsconfig
supabase/
  migrations/         DB migrations (single Supabase project)
  functions/          Optional edge functions
```

## Getting started

```bash
pnpm install
cp .env.example apps/api/.env
cp .env.example apps/web/.env
# fill in Supabase + Monnify keys, then
pnpm dev
```

- Web: http://localhost:5173
- API: http://localhost:4000

## Product

- Host signs up → picks unique slug → gets `bookmi.co/<slug>`
- Host adds services with fixed prices (or pay-what-you-want with a floor)
- Customer visits the slug page → picks a service → pays via Monnify popup
- Booking is confirmed on webhook; funds credit the host wallet minus a platform fee
- Host withdraws to their bank via Monnify disbursement

## Stack

- **Frontend:** Vite, React, Tailwind, Radix (shadcn/ui), TanStack Query, `@supabase/supabase-js`
- **Backend:** NestJS, drizzle-orm, `postgres` driver → Supabase Postgres, Monnify HTTP API
- **DB:** single Supabase Postgres (RLS for public reads; service role for money-touching writes)
- **Auth:** Supabase Auth (email + OAuth), verified server-side by NestJS

## License

Private (Qorelly).
