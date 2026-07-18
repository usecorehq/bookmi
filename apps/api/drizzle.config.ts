import "dotenv/config";
import { defineConfig } from "drizzle-kit";

if (!process.env.SUPABASE_DB_URL) {
  throw new Error("SUPABASE_DB_URL is required for drizzle-kit");
}

export default defineConfig({
  schema: "./src/drizzle/schema.ts",
  out: "./src/drizzle/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.SUPABASE_DB_URL,
  },
  strict: true,
  verbose: true,
});
