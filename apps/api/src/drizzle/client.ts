import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export type SupabaseDb = ReturnType<typeof buildSupabaseDb>;

export function buildSupabaseDb(connectionUrl: string) {
  const client = postgres(connectionUrl, {
    max: 10,
    // Supabase pooler enforces prepare=false; direct connections tolerate it.
    // Auto-detect from URL host suffix.
    prepare: !connectionUrl.includes("pooler.supabase"),
  });
  return drizzle(client, { schema });
}
