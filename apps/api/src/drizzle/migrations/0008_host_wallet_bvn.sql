-- Adds the BVN (Bank Verification Number) column to host_wallets, needed for
-- the (mocked) reserved-account activation flow. Nullable — only populated
-- once a host activates a reserved account. Hand-written rather than
-- drizzle-kit generated to avoid capturing an unrelated concurrent schema
-- change to payment_transactions in the same schema.ts file.
ALTER TABLE "bookmi"."host_wallets" ADD COLUMN "bvn" text;
