CREATE TABLE "bookmi"."paycodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"fee_kobo" bigint,
	"beneficiary_name" text NOT NULL,
	"paycode_reference" text NOT NULL,
	"monnify_transaction_reference" text,
	"masked_paycode" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"expires_at" timestamp with time zone NOT NULL,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmi"."paycodes" ADD CONSTRAINT "paycodes_host_id_host_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "bookmi"."host_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pc_host_idx" ON "bookmi"."paycodes" USING btree ("host_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "pc_reference_uniq" ON "bookmi"."paycodes" USING btree ("paycode_reference");--> statement-breakpoint
CREATE UNIQUE INDEX "pc_host_idempotency_uniq" ON "bookmi"."paycodes" USING btree ("host_id","idempotency_key") WHERE "bookmi"."paycodes"."idempotency_key" IS NOT NULL;