# Cloud Supabase

Point bookmi at a hosted project on [supabase.com](https://supabase.com) instead of running the stack locally. Faster to get moving than [self-hosting](supabase-self-host.md), and it's what production points at today — there's no self-hosted-in-production config in this repo.

## 1. Create the project

1. [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**.
2. Pick an org, name it (e.g. `bookmi-dev` or `bookmi-prod` — use separate projects per environment, don't share one project between dev and prod), pick a region close to your users, set a database password (save it — you'll need it for the connection string).
3. Wait for provisioning (a minute or two).

## 2. Grab the env vars

**Project Settings → API:**

| Value | Env var |
|---|---|
| Project URL | `SUPABASE_URL` / `VITE_SUPABASE_URL` |
| `anon` `public` key | `SUPABASE_ANON_KEY` / `VITE_SUPABASE_ANON_KEY` |
| `service_role` `secret` key | `SUPABASE_SERVICE_ROLE_KEY` — **backend only, never ship this to the frontend** |

**Project Settings → API → JWT Settings:**

| Value | Env var |
|---|---|
| JWT Secret | `SUPABASE_JWT_SECRET` |

**Project Settings → Database → Connection string:**

Two shapes, both work — pick based on where the API runs:

```env
# Direct (fine for most setups; each API instance holds its own connections)
SUPABASE_DB_URL=postgres://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres

# Pooled via Supavisor (use this if you're running many short-lived connections,
# e.g. serverless functions, or see connection-limit errors on the direct URL)
SUPABASE_DB_URL=postgres://postgres.<project-ref>:<password>@<region>.pooler.supabase.com:6543/postgres
```

`apps/api/src/drizzle/client.ts` auto-detects which shape you're using from the URL host (`pooler.supabase` → disables `prepare`, since Supabase's pooler requires that) — no extra config needed either way.

## 3. Fill in the env files

`apps/api/.env`:

```env
SUPABASE_URL=https://<project-ref>.supabase.co
SUPABASE_ANON_KEY=<anon key>
SUPABASE_SERVICE_ROLE_KEY=<service_role key>
SUPABASE_JWT_SECRET=<jwt secret>
SUPABASE_DB_URL=<direct or pooled connection string>
```

`apps/web/.env`:

```env
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<same anon key>
```

Then continue with [local development](local-development.md#5-run-migrations--seed) — `db:migrate`/`db:seed` create bookmi's own tables under the `bookmi` schema in this cloud Postgres.

## 4. Auth configuration

Supabase Auth is used for host sign-up/sign-in (email + OAuth). In the dashboard:

- **Authentication → URL Configuration** — set **Site URL** to your frontend's real URL in prod (e.g. `https://bookmi.co`); in dev, `http://localhost:5173` is fine. Add any additional redirect URLs your OAuth flows need.
- **Authentication → Providers** — enable whichever OAuth providers bookmi's sign-up flow uses, if any beyond email/password.
- **Authentication → Emails → SMTP Settings** (optional) — Supabase's built-in email sender is rate-limited and fine for dev. For anything beyond a handful of signups, either configure Supabase's own SMTP relay here, or use the **Send Email hook** to route confirmation/reset emails through bookmi's own templates (see the hook secret note below).

## 5. GoTrue email hook (optional)

If you want Supabase Auth emails (confirm signup, reset password) to go out through bookmi's own React Email templates instead of Supabase's defaults:

- **Authentication → Hooks → Send Email hook** — point it at your deployed API's hook endpoint and copy the generated secret.
- Set `SUPABASE_EMAIL_HOOK_SECRET` in `apps/api/.env` (prod) to that same secret. Format: `v1,whsec_<base64-secret>`.

Skip this if you're fine with Supabase's default auth emails.

## Multiple environments

Use a separate Supabase project per environment (dev / staging / prod) rather than one project with shared data — the connection string, keys, and JWT secret are all per-project, so switching environments is just swapping which `.env` (or deploy-time secret set) you're using. This also matches the reference-encoding scheme in [Payments](../architecture/payments.md#reference-encoding-for-shared-sandboxes), which is designed around each environment owning its own Monnify sandbox reference prefix — the Supabase side should mirror that isolation.

## Troubleshooting

**`Invalid environment configuration` on API boot.** One of the Supabase vars is missing or malformed — the error names which one.

**`500` on JWT verify.** `SUPABASE_JWT_SECRET` doesn't match the project's actual secret, or you copied the anon/service key into the wrong field. Re-check Settings → API → JWT Settings.

**Connection refused / timeout to `SUPABASE_DB_URL`.** Check the project isn't paused (free-tier projects auto-pause after a week of inactivity — the dashboard shows a "Restore" button), and that your network/firewall allows outbound Postgres connections (some corporate networks block 5432/6543).

## Related

- [Local development](local-development.md) — the rest of the local setup
- [Self-hosted Supabase](supabase-self-host.md) — the local-Docker alternative
- [Deploy backend](deploy-backend.md) — where `SUPABASE_DB_URL` etc. get set in production
