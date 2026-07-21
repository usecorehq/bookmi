# Deploy the backend

The API ships as a single Docker image built from the root [`Dockerfile`](../../Dockerfile) — a three-stage build (Turborepo prune → pnpm build → Alpine runtime) that produces a small, production-only image regardless of where you run it. All three targets below use that same image; only how you point secrets and a domain at it differs.

## What the image does

- **Build**: `turbo prune @bookmi/api --docker` isolates just the API's slice of the monorepo, then `pnpm --filter @bookmi/api build` compiles it, then `pnpm --filter @bookmi/api --prod --legacy deploy /app/pruned` produces a production-only `node_modules`.
- **Runtime**: `node:22-alpine`, runs as the non-root `node` user, listens on `PORT` (default `4000`), exposes a Docker `HEALTHCHECK` that curls `GET /api/health` every 30s.
- **Entrypoint** (`docker/entrypoint.sh`): runs `node dist/migrate.js` (bookmi's own Drizzle migrations) before starting the server, unless `SKIP_MIGRATIONS=true`. This means **the container migrates the DB on every boot** — safe because migrations are idempotent, but worth knowing if you're running multiple replicas (see below).
- Env vars are **not** baked into the image — they're read from the process environment at runtime, so the same image works across dev/staging/prod by swapping the env set at deploy time (see `.dockerignore`'s note that env files are injected at runtime).

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

1. **New Resource → Docker Image** (or **Application** pointed at this git repo, build pack: Dockerfile). If building from git, set the Dockerfile path to the repo root `Dockerfile` — Coolify needs the full monorepo context since the build stage runs `turbo prune` against the whole tree, not just `apps/api`.
2. **Environment variables** — add every var from the table above in Coolify's env editor. Coolify injects these into the running container; nothing needs to be in the image.
3. **Port** — set the container port to `4000` (or whatever you set `PORT` to) and let Coolify's proxy handle the public domain + TLS.
4. **Health check** — Coolify can use the image's built-in `HEALTHCHECK` directive automatically, or you can point its own health-check config at `GET /api/health`.
5. **Deploy.** First boot runs migrations via the entrypoint script — watch the deploy logs for `[entrypoint] Running database migrations…` followed by `[entrypoint] Migrations complete.`

If you scale to multiple replicas later, set `SKIP_MIGRATIONS=true` on all replicas except a dedicated one-off migrate step (or a pre-deploy hook), so N replicas don't all race to run migrations on the same boot — Drizzle's migrations are idempotent so this is a safety/speed concern, not a correctness one, but avoids N processes all doing redundant migration-table locking on every restart.

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

# Run
docker run -d \
  --name bookmi-api \
  -p 4000:4000 \
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
