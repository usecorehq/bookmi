/**
 * Seed bookmi's payment routing tables.
 *
 * Idempotent — uses ON CONFLICT DO UPDATE for the seed rows themselves,
 * so re-running is safe. NOTE: re-runs OVERWRITE admin edits to
 * `country_payment_providers.priority`, so don't wire this into any
 * automated deploy step after the first run. Run manually when you
 * explicitly want to reset routing to seed defaults.
 *
 * Coverage today: Nigeria (active + routed to Monnify). Surrounding
 * markets (KE, GH, ZA, EG) are seeded inactive so their rows exist for
 * the admin to flip on when providers come online.
 *
 * Run with:
 *   pnpm --filter @bookmi/api db:seed
 */

import "dotenv/config";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import {
  countries,
  countryPaymentProviders,
  paymentProviders,
} from "./drizzle/schema";

type CountryRow = {
  code: string;
  name: string;
  defaultCurrency: string;
  isActive: boolean;
};

const COUNTRY_ROWS: CountryRow[] = [
  { code: "NG", name: "Nigeria", defaultCurrency: "NGN", isActive: true },
  { code: "KE", name: "Kenya", defaultCurrency: "KES", isActive: false },
  { code: "GH", name: "Ghana", defaultCurrency: "GHS", isActive: false },
  { code: "ZA", name: "South Africa", defaultCurrency: "ZAR", isActive: false },
  { code: "EG", name: "Egypt", defaultCurrency: "EGP", isActive: false },
];

// Paystack / Flutterwave / Stripe are pre-registered inactive so admins can
// flip them on once the provider adapters land — no schema churn required.
const PROVIDER_ROWS = [
  { code: "monnify", name: "Monnify", isActive: true },
  { code: "paystack", name: "Paystack", isActive: false },
  { code: "flutterwave", name: "Flutterwave", isActive: false },
  { code: "stripe", name: "Stripe", isActive: false },
];

// (country, provider, priority) — 0 is primary, 1+ are fallbacks.
// Monnify is the only wired adapter, so it takes priority 0 for NG today.
const ROUTING_ROWS = [{ countryCode: "NG", providerCode: "monnify", priority: 0 }];

async function main(): Promise<void> {
  const url = process.env.SUPABASE_DB_URL;
  if (!url) {
    console.error("[seed] SUPABASE_DB_URL is not set — refusing to run.");
    process.exit(1);
  }

  const client = postgres(url, { max: 1 });
  const db = drizzle(client);

  try {
    await db
      .insert(countries)
      .values(COUNTRY_ROWS)
      .onConflictDoUpdate({
        target: countries.code,
        set: {
          name: sql`excluded.name`,
          defaultCurrency: sql`excluded.default_currency`,
          isActive: sql`excluded.is_active`,
        },
      });

    await db
      .insert(paymentProviders)
      .values(PROVIDER_ROWS)
      .onConflictDoUpdate({
        target: paymentProviders.code,
        set: { name: sql`excluded.name`, isActive: sql`excluded.is_active` },
      });

    for (const row of ROUTING_ROWS) {
      await db
        .insert(countryPaymentProviders)
        .values(row)
        .onConflictDoUpdate({
          target: [countryPaymentProviders.countryCode, countryPaymentProviders.providerCode],
          set: { priority: sql`excluded.priority`, isActive: sql`true` },
        });
    }

    console.log(
      `[seed] ✓ ${COUNTRY_ROWS.length} countries, ${PROVIDER_ROWS.length} providers, ${ROUTING_ROWS.length} routing row(s)`,
    );
  } finally {
    await client.end({ timeout: 5 });
  }
}

main().catch((err) => {
  console.error("[seed] failed:", err);
  process.exit(1);
});
