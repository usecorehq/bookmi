CREATE TABLE "bookmi"."reserved_bank_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"bank_code" text NOT NULL,
	"bank_name" text NOT NULL,
	"account_number" text NOT NULL,
	"account_name" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmi"."wallet_topups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"provider_reference" text,
	"status" text DEFAULT 'success' NOT NULL,
	"failure_reason" text,
	"payer_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmi"."host_wallets" ADD COLUMN "reserved_account_name" text;--> statement-breakpoint
ALTER TABLE "bookmi"."reserved_bank_accounts" ADD CONSTRAINT "reserved_bank_accounts_host_id_host_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "bookmi"."host_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmi"."wallet_topups" ADD CONSTRAINT "wallet_topups_host_id_host_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "bookmi"."host_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rba_host_idx" ON "bookmi"."reserved_bank_accounts" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rba_host_account_uniq" ON "bookmi"."reserved_bank_accounts" USING btree ("host_id","account_number");--> statement-breakpoint
CREATE UNIQUE INDEX "rba_host_active_uniq" ON "bookmi"."reserved_bank_accounts" USING btree ("host_id") WHERE "bookmi"."reserved_bank_accounts"."is_active" = true;--> statement-breakpoint
CREATE INDEX "wt_host_idx" ON "bookmi"."wallet_topups" USING btree ("host_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "wt_host_provider_ref_uniq" ON "bookmi"."wallet_topups" USING btree ("host_id","provider_reference") WHERE "bookmi"."wallet_topups"."provider_reference" IS NOT NULL;