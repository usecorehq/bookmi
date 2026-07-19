# Local development

Full setup from a clean laptop to a running Bookmi.

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| Node.js | ≥ 20.19 | LTS recommended |
| pnpm | ≥ 10 | `npm install -g pnpm` or via corepack |
| Docker | any recent | For Mailhog. Optional for Supabase (see [self-host guide](supabase-self-host.md)) |
| psql | any | Handy for poking the DB directly. `brew install libpq && brew link libpq --force` on macOS |

You also need a Supabase project. Choose one:

- [Self-hosted local Supabase](supabase-self-host.md) — recommended for uninterrupted offline work
- [Cloud Supabase](supabase-cloud.md) — recommended if you just want to get moving

## 1. Clone + install

```bash
git clone https://github.com/<you>/bookmi.git
cd bookmi
pnpm install
```

The install takes ~30s. It sets up the pnpm workspace (`apps/api`, `apps/web`, `packages/shared-types`, `packages/tsconfig`) and hoists shared deps.

## 2. Copy the env samples

```bash
cp .env.example apps/api/.env
cp .env.example apps/web/.env
```

## 3. Fill in `apps/api/.env`

```env
NODE_ENV=development
APP_ENV=dev
PORT=4000

# Supabase — from your local or cloud project
SUPABASE_URL=http://localhost:8000                # local: :8000. cloud: https://<ref>.supabase.co
SUPABASE_ANON_KEY=<from Supabase>
SUPABASE_SERVICE_ROLE_KEY=<from Supabase>
SUPABASE_JWT_SECRET=<from Supabase>
SUPABASE_DB_URL=postgres://postgres:<pw>@localhost:54322/postgres    # local Supabase runs Postgres on :54322

# Monnify sandbox — from your Monnify merchant dashboard
MONNIFY_BASE_URL=https://sandbox.monnify.com
MONNIFY_API_KEY=MK_TEST_…
MONNIFY_SECRET_KEY=…
MONNIFY_CONTRACT_CODE=…
MONNIFY_WEBHOOK_SECRET=…

# Platform fee in basis points. 250 = 2.5%.
PLATFORM_FEE_BPS=250

# SMTP — leave these as-is if you run Mailhog in Docker.
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
EMAIL_FROM_ADDRESS=no-reply@bookmi.co
EMAIL_FROM_NAME=Bookmi
```

## 4. Fill in `apps/web/.env`

```env
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=<same anon key as apps/api/.env>
VITE_API_URL=http://localhost:4000
VITE_MONNIFY_API_KEY=MK_TEST_…                    # Monnify's publishable key (safe in browser)
VITE_MONNIFY_CONTRACT_CODE=…
```

## 5. Run migrations + seed

```bash
pnpm --filter @bookmi/api db:migrate
pnpm --filter @bookmi/api db:seed
```

- `db:migrate` creates the 11 tables under the `bookmi` schema. Idempotent.
- `db:seed` inserts a country + provider + routing row so `PaymentsService` can resolve Monnify for Nigeria.

Verify:

```bash
psql "$SUPABASE_DB_URL" -c "\dt bookmi.*"
```

Should list `bookings`, `countries`, `host_profiles`, `host_wallets`, `payment_transactions`, etc.

## 6. Start Mailhog (recommended)

```bash
docker compose -f docker/docker-compose.yml up -d mailhog
```

- SMTP available at `localhost:1025` — the API's default
- Web preview at `http://localhost:8025` — see every email the app sends

## 7. Boot both apps

```bash
pnpm dev
```

Turborepo runs both dev servers in parallel. Once they're up:

| URL | What |
|---|---|
| http://localhost:5173 | Web app |
| http://localhost:4000/api/health | `{ status: "ok" }` |
| http://localhost:4000/docs | Swagger UI |
| http://localhost:8025 | Mailhog captured emails |

## The full demo flow

1. Open http://localhost:5173.
2. Click **Sign up** → enter name / email / password.
3. Confirm the OTP from Mailhog (`http://localhost:8025` → the email from Supabase Auth).
4. Land on **Onboarding** → pick a slug (e.g. `demo-spa`) → Continue.
5. On the dashboard, go to **Profile** → set operating hours / bio / bank details / phone. Save.
6. Go to **Services** and add one — "Hydrating Facial", ₦12,000, 45 min. *(Task #41: coming)*
7. Open an incognito window at http://localhost:5173/demo-spa. *(Task #43: coming)*
8. Book + pay via the Monnify sandbox popup.
9. Watch the dashboard update, the wallet increment, and two emails land in Mailhog.

## Running tests

```bash
# All three tiers, in sequence
pnpm --filter @bookmi/api test

# One tier at a time
pnpm --filter @bookmi/api test:unit      # ~1s
pnpm --filter @bookmi/api test:int       # Spins up Postgres via Testcontainers
pnpm --filter @bookmi/api test:e2e       # HTTP surface, fake drizzle
```

Web is a Vite build; no test suite yet. `pnpm --filter @bookmi/web build` catches type errors.

## Preview an email template

```bash
pnpm --filter @bookmi/api email:dev
```

Opens http://localhost:3010. Every `.tsx` in `apps/api/src/modules/emails/templates/` shows up in the left-hand pane. Hot-reloads on save.

## Common commands

```bash
# Regenerate types after a schema tweak
pnpm --filter @bookmi/api db:generate --name=<what_changed>
pnpm --filter @bookmi/api db:migrate

# Open drizzle-kit studio (nice DB inspector)
pnpm --filter @bookmi/api db:studio

# Clean everything and start fresh
pnpm clean && pnpm install
```

## Troubleshooting

**API refuses to boot with `Invalid environment configuration`.** Every required Supabase / Monnify var must be set. The error prints exactly which one.

**`ECONNREFUSED 5432` (or `54322`).** Supabase Postgres isn't running. For local: `supabase start` (see [self-host guide](supabase-self-host.md)). For cloud: check the connection string and network.

**API `500` on JWT verify.** `SUPABASE_JWT_SECRET` must match the project's actual secret. Cloud: Settings → API → JWT Settings.

**Monnify popup can't open (sandbox origin restriction).** Monnify sometimes rejects `localhost:5173`. Fastest workaround: run the frontend behind ngrok (`ngrok http 5173`), then whitelist the ngrok URL in your Monnify dashboard.

**Emails not appearing.** Check Mailhog UI at http://localhost:8025. If empty, confirm the API is pointing at `SMTP_HOST=localhost` `SMTP_PORT=1025`.

**Tests can't reach Postgres.** Integration tests use Testcontainers, which requires Docker running. Start Docker Desktop and retry.
