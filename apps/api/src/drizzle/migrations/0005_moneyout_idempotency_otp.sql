CREATE TABLE "bookmi"."refunds" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"booking_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"idempotency_key" text NOT NULL,
	"destination_bank_code" text NOT NULL,
	"destination_account_number" text NOT NULL,
	"destination_account_name" text NOT NULL,
	"monnify_reference" text,
	"status" text DEFAULT 'processing' NOT NULL,
	"failure_reason" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmi"."security_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"code_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmi"."payouts" ADD COLUMN "idempotency_key" text;--> statement-breakpoint
ALTER TABLE "bookmi"."refunds" ADD CONSTRAINT "refunds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "bookmi"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmi"."refunds" ADD CONSTRAINT "refunds_host_id_host_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "bookmi"."host_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "rf_host_idx" ON "bookmi"."refunds" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "rf_booking_idempotency_uniq" ON "bookmi"."refunds" USING btree ("booking_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "rf_monnify_ref_uniq" ON "bookmi"."refunds" USING btree ("monnify_reference") WHERE "bookmi"."refunds"."monnify_reference" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "sc_user_purpose_expiry_idx" ON "bookmi"."security_challenges" USING btree ("user_id","purpose","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "po_host_idempotency_uniq" ON "bookmi"."payouts" USING btree ("host_id","idempotency_key") WHERE "bookmi"."payouts"."idempotency_key" IS NOT NULL;