# Deploy the frontend

`apps/web` is a static Vite + React SPA (`vite build` → `apps/web/dist/`) — no server-side rendering, no Node process to keep alive. Any static host works; pick whichever your team already uses. `apps/web/vercel.json` already ships an SPA-fallback rewrite for Vercel; the other three hosts need the equivalent rule configured on their end (below).

## Build

```bash
pnpm --filter @bookmi/web build
```

Output lands in `apps/web/dist/`. `pnpm --filter @bookmi/web preview` serves that build locally if you want to sanity-check it before deploying.

## Required environment variables

All must be present **at build time** — Vite inlines `VITE_*` vars into the built JS, they're not read at runtime:

| Var | Notes |
|---|---|
| `VITE_SUPABASE_URL` | Your production [Supabase project](supabase-cloud.md)'s URL. |
| `VITE_SUPABASE_ANON_KEY` | The `anon` key — safe to expose in the browser bundle by design. |
| `VITE_API_URL` | Your deployed backend's URL (see [deploy backend](deploy-backend.md)) — must be reachable from the browser, and must be in that backend's `CORS_ORIGINS`. |
| `VITE_MONNIFY_API_KEY` | Monnify's **publishable** key (not the secret key) — used by the in-browser `monnify-js` popup SDK. |
| `VITE_MONNIFY_CONTRACT_CODE` | Same publishable-key rules. |
| `VITE_CLOUDINARY_CLOUD_NAME`, `VITE_CLOUDINARY_UPLOAD_PRESET` | For avatar upload — the preset must be an **unsigned** upload preset (no server-side signing happens from the SPA). |

Point these at your **production** Monnify contract code and live Supabase project, not sandbox/dev values, before your first real deploy.

## Option A — Vercel

Already the best-supported target — `apps/web/vercel.json` ships the SPA rewrite.

1. **Import project** from this repo. Set **Root Directory** to `apps/web` (Vercel needs to know this is a workspace inside a monorepo).
2. **Framework preset**: Vite. **Build command**: `pnpm --filter @bookmi/web build` (or leave Vercel's monorepo auto-detection to handle it if Root Directory is set correctly — verify the build command it infers actually runs from the repo root so pnpm workspace resolution works).
3. **Output directory**: `dist`.
4. Add the env vars from the table above under **Settings → Environment Variables**, scoped to Production (and separately to Preview if you want preview deploys hitting a staging API).
5. Deploy. The existing `vercel.json` rewrite (`/(.*) → /index.html`) makes client-side routes like `/dashboard` or `/<host-slug>` resolve correctly on refresh instead of 404ing.

## Option B — Netlify

1. **New site from Git**, base directory `apps/web`, build command `pnpm --filter @bookmi/web build` (run from repo root context — Netlify's monorepo support handles this via the base directory setting), publish directory `apps/web/dist`.
2. Add the env vars under **Site configuration → Environment variables**.
3. **SPA fallback** — add a `apps/web/public/_redirects` file (Netlify convention) with:
   ```
   /*  /index.html  200
   ```
   Netlify copies anything in `public/` verbatim into the build output, so this ships as `dist/_redirects` automatically.

## Option C — Firebase Hosting

1. `firebase init hosting` from `apps/web` (or configure `firebase.json` manually) with:
   ```json
   {
     "hosting": {
       "public": "dist",
       "rewrites": [{ "source": "**", "destination": "/index.html" }]
     }
   }
   ```
2. Build locally or in CI (`pnpm --filter @bookmi/web build`) with the env vars set, then `firebase deploy --only hosting`.
3. Firebase Hosting has no server-side env injection — the `VITE_*` vars must be set in whatever CI environment runs the build step.

## Option D — Cloudflare Pages

1. **Create a project**, connect this repo. **Root directory**: `apps/web`. **Build command**: `pnpm --filter @bookmi/web build` (Cloudflare Pages supports monorepos via the root-directory setting — confirm it still runs pnpm install from the repo root so workspace deps resolve). **Build output directory**: `dist`.
2. Add the env vars under the project's **Settings → Environment variables**.
3. **SPA fallback** — add `apps/web/public/_redirects` with:
   ```
   /*  /index.html  200
   ```
   (same file works for both Netlify and Cloudflare Pages).

## Verifying a deploy

- Load the deployed URL directly, then load a deep link like `https://<your-domain>/some-host-slug` directly (not via in-app navigation) — if the SPA rewrite isn't configured, this 404s instead of loading the app and letting React Router take over.
- Open dev tools → Network and confirm API calls go to the right `VITE_API_URL` and don't get blocked by CORS (check the backend's `CORS_ORIGINS` includes this exact origin, scheme included).
- Run the [full demo flow](local-development.md#the-full-demo-flow) against the deployed frontend + backend pair once, end to end, before considering the deploy done.

## Related

- [Deploy backend](deploy-backend.md) — `CORS_ORIGINS` there must include wherever this ends up
- [Cloud Supabase](supabase-cloud.md) — where `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` come from
