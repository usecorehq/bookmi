import { PostgreSqlContainer, StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";

declare global {
  // eslint-disable-next-line no-var
  var __PG_CONTAINER__: StartedPostgreSqlContainer | undefined;
}

/**
 * Globally boots a Postgres container, applies the bookmi schema, and hands
 * the connection URL to every int-spec via SUPABASE_DB_URL. Runs once per
 * `jest --selectProjects integration` invocation.
 */
export default async function setup(): Promise<void> {
  const pg = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("bookmi_test")
    .withUsername("bookmi")
    .withPassword("bookmi")
    .start();

  const url = pg.getConnectionUri();
  process.env.SUPABASE_DB_URL = url;

  const schemaSql = readFileSync(resolve(__dirname, "fixtures/schema.sql"), "utf-8");
  const client = postgres(url, { max: 1 });
  try {
    // Drizzle emits `--> statement-breakpoint` between DDL statements.
    // Split on them so multi-DDL scripts land as separate exec calls.
    for (const statement of schemaSql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed) await client.unsafe(trimmed);
    }
  } finally {
    await client.end({ timeout: 5 });
  }

  globalThis.__PG_CONTAINER__ = pg;

  console.log(`[testcontainers] postgres ready at ${url}`);
}
