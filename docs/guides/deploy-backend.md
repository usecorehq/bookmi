# Deploy the backend

The API ships as a single Docker image built from the root [`Dockerfile`](../../Dockerfile) — a three-stage build (Turborepo prune → pnpm build → Alpine runtime) that produces a small, production-only image regardless of where you run it. All three targets below use that same image; only how you point secrets and a domain at it differs.

## What the image does

- **Build**: `turbo prune @bookmi/api --docker` isolates just the API's slice of the monorepo, then `pnpm --filter @bookmi/api build` compiles it, then `pnpm --filter @bookmi/api --prod --legacy deploy /app/pruned` produces a production-only `node_modules`.
- **Runtime**: `node:22-alpine`, runs as the non-root `node` user, listens on `PORT` (default `4000`), exposes a Docker `HEALTHCHECK` that curls `GET /api/health` every 30s (web) or short-circuits to `exit 0` (worker — headless).
- **Entrypoint** (`docker/entrypoint.sh`): runs `node dist/migrate.js` (bookmi's own Drizzle migrations) before starting the process, unless `SKIP_MIGRATIONS=true`. Then dispatches on `APP_ROLE`:
  - `APP_ROLE=web` (default) → `node dist/main.js` — HTTP API on `PORT`.
  - `APP_ROLE=worker` → `node dist/main.worker.js` — headless: BullMQ consumers (email queue, paycode expiry sweep) + `@nestjs/schedule` runtime for any future `@Cron` decorators. No HTTP server, no Swagger, no Bull Board.
- Env vars are **not** baked into the image — they're read from the process environment at runtime, so the same image works across dev/staging/prod by swapping the env set at deploy time (see `.dockerignore`'s note that env files are injected at runtime).

### Web vs worker: what changes

Same image, same env vars (Redis and DB creds especially **must match**), just a different `APP_ROLE`. Producers (`EmailsService`, `PaycodeService`) live in the web-side feature modules so HTTP handlers can enqueue jobs; the matching `@Processor` classes live in [`workers.module.ts`](../../apps/api/src/workers.module.ts) and only run in the worker container. Bull Board's admin UI (`/api/admin/queues`) is web-only — it needs an HTTP server to mount routes.

Both containers migrate on boot by default (idempotent, safe under concurrent startup via Drizzle's advisory lock). At N=1 web + N=1 worker this is fine; scale beyond that and set `SKIP_MIGRATIONS=true` on all replicas except a dedicated pre-deploy migrate step.

## Required environment variables

Everything in `apps/api/.env.example`, most importantly:

| Var | Notes |
|---|---|
| `NODE_ENV=production`, `APP_ENV=prod` | |
| `PORT` | Must match whatever port your platform routes to (image defaults to `4000`). |
| `CORS_ORIGINS` | Comma-separated list — must include your deployed frontend's origin. |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_DB_URL` | From your [cloud Supabase project](supabase-cloud.md) — production should point at a real hosted project, not local self-host. |
| `MONNIFY_BASE_URL` | `https://api.monnify.com` in prod (not the sandbox URL). |
| `MONNIFY_API_KEY`, `MONNIFY_SECRET_KEY`, `MONNIFY_CONTRACT_CODE`, `MONNIFY_WEBHOOK_SECRET`, `MONNIFY_DISBURSEMENT_WALLET` | Live Monnify merchant credentials — separate from sandbox. |
| `PLATFORM_FEE_BPS` | Your live platform fee. |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_SECURE`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME` | A real SMTP relay (Resend/SES/Mailgun) — not Mailhog. |
| `WEB_BASE_URL` | Your deployed frontend's URL — used to build links in auth emails. |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD`, `REDIS_QUEUE_DB` | BullMQ's backing store for the email queue — needs a real Redis instance in prod (see below). |
| `BULL_BOARD_USER`, `BULL_BOARD_PASS` | Optional — enables `/api/admin/queues`, HTTP Basic-protected. |

You also need a **Redis instance** reachable from the API in production — `docker/docker-compose.yml`'s Redis service is dev-only. Most platforms below have a one-click managed Redis add-on; a small instance is enough (it's just backing the email-send queue).

## Option A — Coolify

This is the path with the most direct evidence in the repo's history (`.dockerignore`'s "env files (injected by Coolify at runtime)" comment, and several past commits fixing Coolify-specific build issues).

Deploy **two services from the same image** — one web, one worker — so background work (email send, paycode expiry sweep, future crons) has its own process that scales, restarts, and drains independently of HTTP.

### Web service

1. **New Resource → Application** pointed at this git repo (build pack: Dockerfile). Set the Dockerfile path to the repo root `Dockerfile` — Coolify needs the full monorepo context because the build stage runs `turbo prune` against the whole tree, not just `apps/api`.
2. **Environment variables** — every var from the table above. Leave `APP_ROLE` unset (or set explicitly to `web`).
3. **Port** — container port `4000` (or your `PORT` override). Coolify's proxy handles the public domain + TLS.
4. **Health check** — Coolify uses the image's built-in `HEALTHCHECK` (curls `GET /api/health`).
5. **Deploy.** First boot runs migrations via the entrypoint — watch for `[entrypoint] Running database migrations…` followed by `[entrypoint] Starting Bookmi API`.

### Worker service

1. **Clone the web service** in Coolify (or add a second Application pointed at the same repo + Dockerfile).
2. **Environment variables** — copy every var from the web service. Redis and DB creds **must be identical** — the worker connects to the same queues the web enqueues to and the same databases it reads. Then add / override:
   - `APP_ROLE=worker`
   - `SKIP_MIGRATIONS=true` — the web service already migrated on its boot; leaving both racing is safe (advisory-lock serialized) but redundant.
3. **No port, no domain, no proxy** — the worker is headless. Remove any public exposure Coolify wired in from the clone.
4. **Health check** — leave the built-in `HEALTHCHECK`; the script short-circuits to `exit 0` for the worker role. Coolify detects crashes via container status.
5. **Deploy.** Logs should show `[entrypoint] Starting Bookmi worker (schedulers + BullMQ consumers)…` followed by `Worker ready — schedulers + BullMQ consumers active`.

Scale each independently: bump worker replicas when the email queue backs up; bump web replicas when HTTP latency climbs. If you scale web past N=1, set `SKIP_MIGRATIONS=true` there too and run migrations from a dedicated pre-deploy hook so N processes don't all race the migration-table lock on every restart.

## Option B — DigitalOcean App Platform

1. **Create App → from a Dockerfile.** Point it at this repo; App Platform detects the root `Dockerfile` automatically. Set the build context to the repo root (not `apps/api`) for the same reason as Coolify above — the Turborepo prune step needs the whole workspace.
2. **HTTP port**: `4000` (or your `PORT` override).
3. **Environment variables**: add the table above under the app's **Settings → App-Level Environment Variables** (or component-level if you're running other services in the same app). Mark secrets (Monnify keys, Supabase service role key, SMTP password) as **encrypted**.
4. **Health check**: App Platform reads the Dockerfile's `HEALTHCHECK` by default; you can also set an explicit HTTP health check against `/api/health` in the component settings.
5. **Managed Redis**: add a DigitalOcean Managed Redis database as a companion resource, or point `REDIS_HOST`/`REDIS_PORT`/`REDIS_PASSWORD` at any reachable Redis.
6. **Deploy** — App Platform builds the image from the Dockerfile and runs it; check the runtime logs for the same entrypoint migration output as above.

## Option C — Plain Docker (any VPS / bare Docker host)

```bash
# Build (run from the repo root — the build needs the full monorepo context)
docker build -t bookmi-api .

# Web
docker run -d \
  --name bookmi-api-web \
  -p 4000:4000 \
  --env-file apps/api/.env.production \
  --restart unless-stopped \
  bookmi-api

# Worker (same image, same env — the entrypoint dispatches on APP_ROLE)
docker run -d \
  --name bookmi-api-worker \
  -e APP_ROLE=worker \
  -e SKIP_MIGRATIONS=true \
  --env-file apps/api/.env.production \
  --restart unless-stopped \
  bookmi-api
```

Notes:

- `--env-file` expects a flat `KEY=value` file — the same shape as `apps/api/.env.example`, just filled in with production values. Don't commit this file.
- Put a reverse proxy (Caddy, Nginx, Traefik) in front for TLS termination and to route your domain to port `4000`.
- Redis and Postgres are **not** included in this image — Postgres is Supabase's hosted Postgres (via `SUPABASE_DB_URL`), and Redis needs to be a separate container or managed instance reachable from this one (e.g. `docker run -d --name redis -p 6379:6379 redis:7-alpine` for a same-host setup, then `REDIS_HOST=<host-ip-or-container-name>`).
- Docker's built-in `HEALTHCHECK` (baked into the image) will show up in `docker ps`'s STATUS column and in `docker inspect`.

## Verifying a deploy

```bash
curl https://<your-api-domain>/api/health
# {"status":"ok"}

curl https://<your-api-domain>/docs
# Swagger UI
```

Then run one real flow — sign up a test host, complete onboarding, and hit `POST /api/public/<slug>/checkout` against the Monnify **sandbox** (before flipping to live keys) to confirm the whole payment path works end-to-end against the deployed instance.

## Related

- [Cloud Supabase](supabase-cloud.md) — where `SUPABASE_DB_URL` and friends come from
- [Deploy frontend](deploy-frontend.md) — the other half; make sure `CORS_ORIGINS` here matches where that ends up
- [Payments](../architecture/payments.md#reference-encoding-for-shared-sandboxes) — env-prefixed references matter if you're running dev/staging/prod against a shared Monnify sandbox mode
