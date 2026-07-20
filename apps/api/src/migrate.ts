/**
 * Standalone Drizzle migration runner.
 *
 * Called by docker/entrypoint.sh on every container start:
 *   node dist/migrate.js
 *
 * Drizzle's migrate() serialises concurrent startups via a Postgres
 * advisory lock, so it is safe to run from both web and worker containers
 * simultaneously — only one will apply new migrations and the others skip.
 *
 * SUPABASE_DB_URL must be set in the environment before invoking.
 *
 * NOTE: This file is compiled as CommonJS (same tsconfig as the rest of the
 * API). Top-level await and import.meta are not available; we use an async
 * IIFE instead.
 */
import path from "path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error("[migrate] SUPABASE_DB_URL is not set — aborting.");
  process.exit(1);
}

// In the Docker image the compiled file is at dist/migrate.js and
// migrations are copied to src/drizzle/migrations relative to WORKDIR /app.
// __dirname inside dist/ is /app/dist, so we step up one level.
const migrationsFolder = path.resolve(__dirname, "../src/drizzle/migrations");

void (async () => {
  const sql = postgres(dbUrl as string, {
    max: 1,
    connect_timeout: 30,
  });

  const db = drizzle(sql);

  console.log("[migrate] Applying migrations from", migrationsFolder);
  await migrate(db, { migrationsFolder });
  console.log("[migrate] Done.");

  await sql.end();
})().catch((err: unknown) => {
  console.error("[migrate] Fatal:", err);
  process.exit(1);
});
