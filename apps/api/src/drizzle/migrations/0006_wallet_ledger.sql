CREATE TABLE "bookmi"."wallet_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"type" text NOT NULL,
	"source_id" uuid,
	"source_type" text NOT NULL,
	"source_mode" text NOT NULL,
	"balance_before_kobo" bigint NOT NULL,
	"balance_after_kobo" bigint NOT NULL,
	"status" text DEFAULT 'success' NOT NULL,
	"memo" text,
	"current_hash" text NOT NULL,
	"prev_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmi"."wallet_ledger" ADD CONSTRAINT "wallet_ledger_host_id_host_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "bookmi"."host_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "wl_host_created_idx" ON "bookmi"."wallet_ledger" USING btree ("host_id","created_at");--> statement-breakpoint
CREATE INDEX "wl_source_idx" ON "bookmi"."wallet_ledger" USING btree ("source_type","source_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wl_hash_uniq" ON "bookmi"."wallet_ledger" USING btree ("current_hash");