# Self-hosted Supabase (local dev)

Runs Supabase's full stack (Postgres, GoTrue auth, the API gateway) in Docker on your laptop via the Supabase CLI, so you can develop offline with no dependency on supabase.com being up.

This is the **local development** setup — bookmi doesn't ship its own production self-host config. If you're deploying to production, either use [Cloud Supabase](supabase-cloud.md), or see [Self-hosting in production](#self-hosting-in-production) below for Supabase's own canonical self-hosting docs.

## Prerequisites

- Docker Desktop (or a Docker daemon) running.
- The Supabase CLI: `brew install supabase/tap/supabase` (macOS) or see the [CLI install docs](https://supabase.com/docs/guides/cli/getting-started) for other platforms.

## 1. Initialize the Supabase project

From the repo root (bookmi doesn't check in a `supabase/` directory, so this is a one-time step per clone/machine):

```bash
supabase init
```

This creates a local `supabase/` folder with config + migration scaffolding. It's gitignored in this repo — every developer runs their own local stack.

## 2. Start the stack

```bash
supabase start
```

First run pulls several Docker images and takes a few minutes. Once it's up, the CLI prints a table of local endpoints and keys — the ones bookmi needs:

| What | Typical local value |
|---|---|
| API URL | `http://localhost:8000` |
| DB URL | `postgres://postgres:postgres@localhost:54322/postgres` |
| anon key | printed by the CLI |
| service_role key | printed by the CLI |
| JWT secret | printed by the CLI |
| Studio (DB browser + Auth UI) | `http://localhost:54323` |

Keep this terminal output around — you're about to paste these values into `apps/api/.env` and `apps/web/.env`.

```bash
# Reprint the same values any time
supabase status
```

## 3. Wire bookmi to it

In `apps/api/.env`:

```env
SUPABASE_URL=http://localhost:8000
SUPABASE_ANON_KEY=<anon key from `supabase status`>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from `supabase status`>
SUPABASE_JWT_SECRET=<JWT secret from `supabase status`>
SUPABASE_DB_URL=postgres://postgres:postgres@localhost:54322/postgres
```

In `apps/web/.env`:

```env
VITE_SUPABASE_URL=http://localhost:8000
VITE_SUPABASE_ANON_KEY=<same anon key>
```

Then continue with the rest of [local development](local-development.md#5-run-migrations--seed) — `db:migrate` and `db:seed` run bookmi's own Drizzle migrations against this Postgres instance; they're separate from anything Supabase's CLI manages.

## GoTrue email hook (optional)

If you enable Supabase's "Send Email" auth hook (used to route confirmation/reset emails through bookmi's own templates instead of Supabase's default ones), the shared secret lives in two places that must match:

- `GOTRUE_HOOK_SEND_EMAIL_SECRETS` in your local Supabase config (`supabase/config.toml`, under `[auth.hook.send_email]`).
- `SUPABASE_EMAIL_HOOK_SECRET` in `apps/api/.env`.

Format: `v1,whsec_<base64-secret>`. Skip this entirely if you're not using the hook — Mailhog + bookmi's own SMTP sending work without it.

## Stopping / resetting

```bash
supabase stop          # stops containers, keeps data
supabase stop --no-backup  # stops and wipes local data
supabase db reset       # drops + recreates the local DB, then reruns Supabase's own migrations (not bookmi's)
```

After a `db reset`, rerun `pnpm --filter @bookmi/api db:migrate && pnpm --filter @bookmi/api db:seed` to reapply bookmi's schema.

## Troubleshooting

**Ports already in use.** Another Supabase project (or a stale container) is bound to 54322/8000/54323. `supabase stop` in the other project directory, or `docker ps` to find and stop the stray containers.

**`supabase start` hangs on "Starting Auth service".** Usually a slow first-time image pull. Give it a few minutes; check `docker ps` to confirm containers are actually starting, not crash-looping.

**Studio (`:54323`) shows no tables.** You've run `supabase start` but not yet `pnpm --filter @bookmi/api db:migrate` — bookmi's tables live under the `bookmi` schema, created by its own Drizzle migrations, not by Supabase's scaffold.

## Self-hosting in production

Everything above is the **local development** loop (`supabase start` via the CLI) — it is not a production deployment. If you want to run your own Supabase stack in production instead of using [Cloud Supabase](supabase-cloud.md), don't follow bookmi-specific steps for that here — Supabase's own self-hosting story (Docker Compose stack, Kubernetes/Helm alternative, what's included vs. platform-only, and the operator responsibilities you take on: server provisioning, security hardening, backups, disaster recovery, monitoring) changes over time and is documented and kept current at:

**[supabase.com/docs/guides/self-hosting](https://supabase.com/docs/guides/self-hosting)**

Once you have a self-hosted Supabase stack running in production, wiring bookmi to it is the same as any other Postgres + Auth endpoint: fill in `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, and `SUPABASE_DB_URL` in `apps/api/.env` (and the `VITE_SUPABASE_*` pair in `apps/web/.env`) pointing at your self-hosted instance instead of a `*.supabase.co` cloud project — same env vars, same [local development](local-development.md) steps from there. See [Deploy backend](deploy-backend.md) for how those env vars get into a running deployment.

## Related

- [Local development](local-development.md) — the rest of the local setup
- [Cloud Supabase](supabase-cloud.md) — the alternative to running this locally
