ALTER TABLE "bookmi"."host_wallets" ADD COLUMN "bvn" text;--> statement-breakpoint
ALTER TABLE "bookmi"."payment_transactions" ADD COLUMN "provider_transaction_id" text;