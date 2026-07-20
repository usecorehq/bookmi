# Emails — React Email + provider abstraction

Bookmi renders every email as React (via [react-email](https://react.email)) and sends via SMTP. The provider is abstracted so swapping SMTP → Resend HTTP → SES → Mailgun is one class.

## Design principles

1. **Templates as React** — no hand-crafted HTML strings, no MJML, no template DSL. Change a color, ship a new email, add MFA text — normal React work.
2. **Live preview** — every template exports `PreviewProps`; `pnpm --filter @bookmi/api email:dev` boots a hot-reloading browser preview at `http://localhost:3010`.
3. **Send, don't unwind** — email delivery is best-effort. A transient SMTP outage must never unwind a settled payment. Callers wrap in `try/catch`; the payment stays confirmed even if the emails silently fail.
4. **Provider abstraction** — the send path (SMTP, Resend HTTP, SES) is behind `EmailProvider`. Templates and callers don't know or care.
5. **Type-safe payloads** — `EmailJob` is a discriminated union. TS refuses to compile a `send()` call with wrong fields for the chosen `kind`.

## The three moving parts

### 1. Templates

Live under `apps/api/src/modules/emails/templates/`. Each template file exports:

- `default` — a React component receiving typed data.
- `subject(data)` — a per-template subject-line function.
- `PreviewProps` — sample data for the dev preview (`satisfies` typed).

```
templates/
├── _layout/
│   ├── BrandShell.tsx        # <Html><Head/><Body> + logo + footer
│   └── tokens.ts             # colors, radii, container width, logo URL
├── BookingConfirmedHostTemplate.tsx
└── BookingConfirmedCustomerTemplate.tsx
```

Every template renders inside `<BrandShell>`. A rebrand touches `_layout/tokens.ts` only.

Adding a new template:

1. Drop `Foo.tsx` in `templates/` with `default` + `subject` + `PreviewProps`.
2. Add a new variant to `EmailJob` in `emails.types.ts`.
3. Add a case in `EmailsService.send()`.

The docstring at the top of `emails.types.ts` and `emails.service.ts` both call this out.

### 2. Provider abstraction

```ts
// providers/email-provider.interface.ts
interface EmailProvider {
  send(payload: { to: string; subject: string; html: string }): Promise<void>;
}
export const EMAIL_PROVIDER = Symbol("EMAIL_PROVIDER");
```

The module registers one concrete provider (`SmtpProvider` via `@nestjs-modules/mailer`) and aliases the `EMAIL_PROVIDER` token to it:

```ts
providers: [
  EmailsService,
  SmtpProvider,
  { provide: EMAIL_PROVIDER, useExisting: SmtpProvider },
]
```

Swap to Resend later: implement `ResendProvider implements EmailProvider`, replace `useExisting: SmtpProvider` with `useExisting: ResendProvider`. No callsite changes.

For dev, SMTP points at **Mailhog** (`localhost:1025`, web preview at `localhost:8025`). For prod, SMTP points at whichever relay you prefer (Resend's SMTP relay is `smtp.resend.com:465`, user `resend`, pass = your Resend API key). No code change; just env.

### 3. Preview server

```
"email:dev": "email dev --dir src/modules/emails/templates --port 3010"
```

`react-email@^6`'s CLI. Auto-discovers every `.tsx` in `templates/`, renders in an iframe, hot-reloads on save. Every template's `PreviewProps` is picked up so you see realistic data (booking codes, host names, sample services) instead of empty state.

Open http://localhost:3010, click a template on the left, see the rendered HTML on the right.

## Why send inline (for now)

qore-backend runs emails through **BullMQ** — the API enqueues a job, a worker container consumes it, retries with exponential backoff, dedupes on `jobId`. That's the right shape for a mature product.

Bookmi's MVP sends inline:

```ts
// booking-checkout.handler.ts::onSuccess (after wallet credit)
try {
  await this.emails.send({ kind: "booking_confirmed_host", to: host.email, data: {...} });
  await this.emails.send({ kind: "booking_confirmed_customer", to: booking.customerEmail, data: {...} });
} catch (err) {
  this.logger.error("booking-confirmed emails failed", err);
  // Do NOT rethrow — email is best-effort, wallet is already credited.
}
```

Rationale:

- **No Redis** to run. bookmi's Docker Compose has zero required services beyond the DB.
- **The trade-off is bounded** — the only email we send today is booking-confirmed, sent right after the payment settles. If SMTP is down, the customer still has their booking confirmed on-screen; the host still sees the row in the dashboard. Nobody misses money.

### Upgrade path

The payload shape (`EmailJob` discriminated union) is **already queue-compatible**. When it's time:

1. Add `@nestjs/bullmq`, `bullmq`, `ioredis`, a `QueuesModule` with `QUEUE_EMAILS`.
2. Rename `EmailsService.send()` → `enqueue()` and have it call `queue.add(job.kind, job, { attempts: 5, backoff: 10s exponential })`.
3. Add `EmailsProcessor` (Bull `@Processor`) that inline-renders + provider-sends — literally the current `send()` body.
4. Add a worker container that runs `EmailsProcessor` (see qore-backend's `workers.module.ts` + `main.worker.ts` for the two-role Nest bootstrap pattern).

Callsites in `booking-checkout.handler.ts` don't change.

## Overriding Supabase Auth Emails (Optional)

By default, Supabase's internal auth server (GoTrue) handles signup confirmations, password recovery, magic links, and email changes using its built-in SMTP engine and basic HTML templates. 

Bookmi supports overriding these default emails so they are rendered using our React Email templates (`ConfirmEmailTemplate` and `ResetPasswordTemplate`) and sent via our backend's mail provider.

### How it Works
When the **Send Email Hook** is enabled, GoTrue intercepts all auth emails and fires a signed HTTP POST request containing user details, the OTP token, the token hash, and redirect URLs to our backend:
`POST /api/auth/email-hook`

The backend verifies the request signature (using Standard Webhooks spec), parses the payload, and sends the custom email using the backend's `EmailsService`.

### Setup

#### A. For Self-Hosted Supabase (Docker)
In your self-hosted Supabase setup, hooks are configured via environment variables on the `auth` (GoTrue) container. Uncomment/add the following under the `auth` service in your `docker-compose.yml`:

```yaml
services:
  auth:
    environment:
      # Enable the Send Email Auth Hook
      GOTRUE_HOOK_SEND_EMAIL_ENABLED: "true"
      
      # The webhook endpoint on your NestJS API
      # Use host.docker.internal in local dev so the container can talk to the host machine's port 4000
      GOTRUE_HOOK_SEND_EMAIL_URI: "http://host.docker.internal:4000/api/auth/email-hook"
      
      # Webhook secret key for signing payload (must start with v1,whsec_)
      GOTRUE_HOOK_SEND_EMAIL_SECRETS: "v1,whsec_VGhpcyBpcyBhbiBleGFtcGxlIG9mIGEgc2hvcnRlciBCYXNlNjQgc3RyaW5n"
```

Then, add the corresponding secret to your backend env file (`apps/api/.env`):
```env
SUPABASE_EMAIL_HOOK_SECRET=v1,whsec_VGhpcyBpcyBhbiBleGFtcGxlIG9mIGEgc2hvcnRlciBCYXNlNjQgc3RyaW5n
```

Recreate the container:
```bash
docker compose up -d --force-recreate auth
```

#### B. For Supabase Cloud
1. Navigate to your **Supabase Dashboard > Authentication > Hooks**.
2. Select **Send Email Hook** and set the Type to **HTTPS Webhook** (POST).
3. Set the Endpoint URL to: `https://your-backend-api.com/api/auth/email-hook`
4. Copy the generated **Webhook Secret** and save it in your backend env file:
   `SUPABASE_EMAIL_HOOK_SECRET=whsec_your_secret`

---

## Env vars

Seven of them, all with sensible dev defaults:

```
SMTP_HOST=localhost       # Mailhog default
SMTP_PORT=1025
SMTP_USER=                # empty in dev
SMTP_PASS=                # empty in dev
SMTP_SECURE=false
EMAIL_FROM_ADDRESS=no-reply@bookmi.co
EMAIL_FROM_NAME=Bookmi
```

For prod-with-Resend:

```
SMTP_HOST=smtp.resend.com
SMTP_PORT=465
SMTP_USER=resend
SMTP_PASS=<your Resend API key>
SMTP_SECURE=true
```

For prod-with-SES: same shape, different creds. Validated at boot by class-validator + config namespace `mailer.*`.

## Testing

`emails.service.spec.ts` renders each template with `@react-email/render` and asserts key strings land in the HTML (host name, booking code, service titles, CTA href, "Powered by Qorelly" chrome). Cheap insurance since a broken template ships silently in production.

Jest needs `NODE_OPTIONS=--experimental-vm-modules` because `@react-email/render` uses dynamic imports. The test scripts include it:

```json
"test:unit": "NODE_OPTIONS=--experimental-vm-modules jest --selectProjects unit"
```

## Files

| File | What it holds |
|---|---|
| `apps/api/src/modules/emails/emails.module.ts` | `@Global()` module; `MailerModule.forRootAsync` + provider wiring |
| `apps/api/src/modules/emails/emails.service.ts` | Render + send. One switch on `job.kind`. |
| `apps/api/src/modules/emails/emails.service.spec.ts` | Renders both templates, asserts contents |
| `apps/api/src/modules/emails/emails.types.ts` | `EmailJob` discriminated union |
| `apps/api/src/modules/emails/providers/email-provider.interface.ts` | The 3-line contract + `EMAIL_PROVIDER` symbol |
| `apps/api/src/modules/emails/providers/smtp.provider.ts` | nodemailer wrapper |
| `apps/api/src/modules/emails/templates/_layout/BrandShell.tsx` | Shared chrome |
| `apps/api/src/modules/emails/templates/_layout/tokens.ts` | Brand tokens |
| `apps/api/src/modules/emails/templates/BookingConfirmedHostTemplate.tsx` | Host email |
| `apps/api/src/modules/emails/templates/BookingConfirmedCustomerTemplate.tsx` | Customer email |
| `apps/api/src/modules/emails/templates/ConfirmEmailTemplate.tsx` | Signup confirmation email (OTP & Link) |
| `apps/api/src/modules/emails/templates/ResetPasswordTemplate.tsx` | Password reset email (OTP & Link) |
| `apps/api/src/modules/auth/helpers/signature.helper.ts` | HMAC-SHA256 signature verification helper for standard webhooks |
| `docker/docker-compose.yml` | Mailhog for local capture |

## Related

- [Payments](payments.md) — where the emails get fired from
- [Booking flow](booking-flow.md) — the customer's experience of the confirmation
