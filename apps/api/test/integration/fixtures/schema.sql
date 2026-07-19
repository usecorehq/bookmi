CREATE SCHEMA "bookmi";
--> statement-breakpoint
CREATE TABLE "bookmi"."bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"service_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"customer_email" text NOT NULL,
	"customer_phone" text,
	"slot_start_at" timestamp with time zone,
	"amount_kobo" bigint NOT NULL,
	"platform_fee_kobo" bigint DEFAULT 0 NOT NULL,
	"net_to_host_kobo" bigint DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_transaction_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmi"."countries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"default_currency" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "countries_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "bookmi"."country_payment_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"country_code" text NOT NULL,
	"provider_code" text NOT NULL,
	"priority" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmi"."host_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"avatar_url" text,
	"accent_color" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_profiles_user_id_unique" UNIQUE("user_id"),
	CONSTRAINT "host_profiles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "bookmi"."host_wallets" (
	"host_id" uuid PRIMARY KEY NOT NULL,
	"monnify_wallet_reference" text,
	"reserved_account_number" text,
	"reserved_bank_name" text,
	"balance_kobo" bigint DEFAULT 0 NOT NULL,
	"bank_code" text,
	"bank_account_number" text,
	"bank_account_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmi"."payment_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"from_status" text,
	"to_status" text,
	"source" text NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmi"."payment_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_providers_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "bookmi"."payment_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reference" text NOT NULL,
	"provider_code" text NOT NULL,
	"provider_reference" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"amount_minor" bigint NOT NULL,
	"currency" text NOT NULL,
	"fee_minor" bigint,
	"net_amount_minor" bigint,
	"country_code" text NOT NULL,
	"purpose_type" text NOT NULL,
	"purpose_id" uuid,
	"business_id" uuid,
	"initiator_user_id" uuid NOT NULL,
	"payer_email" text NOT NULL,
	"authorization_code" text,
	"access_code" text,
	"authorization_url" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"idempotency_key" text,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_initiated_at" timestamp with time zone,
	"verified_at" timestamp with time zone,
	"webhook_received_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_transactions_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "bookmi"."payment_webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_code" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"signature" text,
	"raw_payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	"transaction_id" uuid,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "bookmi"."payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"amount_kobo" bigint NOT NULL,
	"destination_bank_code" text NOT NULL,
	"destination_account_number" text NOT NULL,
	"monnify_reference" text,
	"status" text DEFAULT 'initiated' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bookmi"."services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"price_kobo" bigint NOT NULL,
	"duration_minutes" integer,
	"pay_what_you_want" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD CONSTRAINT "bookings_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "bookmi"."services"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD CONSTRAINT "bookings_host_id_host_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "bookmi"."host_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD CONSTRAINT "bookings_payment_transaction_id_payment_transactions_id_fk" FOREIGN KEY ("payment_transaction_id") REFERENCES "bookmi"."payment_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmi"."host_wallets" ADD CONSTRAINT "host_wallets_host_id_host_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "bookmi"."host_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmi"."payouts" ADD CONSTRAINT "payouts_host_id_host_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "bookmi"."host_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmi"."services" ADD CONSTRAINT "services_host_id_host_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "bookmi"."host_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bk_host_status_idx" ON "bookmi"."bookings" USING btree ("host_id","status");--> statement-breakpoint
CREATE INDEX "bk_service_idx" ON "bookmi"."bookings" USING btree ("service_id");--> statement-breakpoint
CREATE INDEX "bk_slot_idx" ON "bookmi"."bookings" USING btree ("host_id","slot_start_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cpp_country_provider_uniq" ON "bookmi"."country_payment_providers" USING btree ("country_code","provider_code");--> statement-breakpoint
CREATE INDEX "cpp_country_priority_idx" ON "bookmi"."country_payment_providers" USING btree ("country_code","priority");--> statement-breakpoint
CREATE INDEX "hp_slug_idx" ON "bookmi"."host_profiles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "pe_tx_idx" ON "bookmi"."payment_events" USING btree ("transaction_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pt_provider_ref_uniq" ON "bookmi"."payment_transactions" USING btree ("provider_code","provider_reference") WHERE "bookmi"."payment_transactions"."provider_reference" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "pt_idempotency_uniq" ON "bookmi"."payment_transactions" USING btree ("initiator_user_id","idempotency_key") WHERE "bookmi"."payment_transactions"."idempotency_key" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "pt_business_idx" ON "bookmi"."payment_transactions" USING btree ("business_id");--> statement-breakpoint
CREATE INDEX "pt_purpose_idx" ON "bookmi"."payment_transactions" USING btree ("purpose_type","purpose_id");--> statement-breakpoint
CREATE INDEX "pt_status_idx" ON "bookmi"."payment_transactions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "pwe_provider_event_uniq" ON "bookmi"."payment_webhook_events" USING btree ("provider_code","provider_event_id");--> statement-breakpoint
CREATE INDEX "pwe_unprocessed_idx" ON "bookmi"."payment_webhook_events" USING btree ("received_at") WHERE "bookmi"."payment_webhook_events"."processed_at" IS NULL;--> statement-breakpoint
CREATE INDEX "po_host_idx" ON "bookmi"."payouts" USING btree ("host_id","status");--> statement-breakpoint
CREATE INDEX "svc_host_idx" ON "bookmi"."services" USING btree ("host_id","active");ALTER TABLE "bookmi"."bookings" DROP CONSTRAINT "bookings_service_id_services_id_fk";
--> statement-breakpoint
DROP INDEX "bookmi"."bk_service_idx";--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "service_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "duration_minutes" integer DEFAULT 30 NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "code" text;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "source" text DEFAULT 'storefront' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "customer_notes" text;--> statement-breakpoint
ALTER TABLE "bookmi"."host_profiles" ADD COLUMN "operating_hours" jsonb DEFAULT '{"monday":{"open":"09:00","close":"18:00","closed":false},"tuesday":{"open":"09:00","close":"18:00","closed":false},"wednesday":{"open":"09:00","close":"18:00","closed":false},"thursday":{"open":"09:00","close":"18:00","closed":false},"friday":{"open":"09:00","close":"18:00","closed":false},"saturday":{"open":"09:00","close":"18:00","closed":false},"sunday":{"open":"09:00","close":"18:00","closed":false}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmi"."host_profiles" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "bookmi"."host_profiles" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" DROP COLUMN "service_id";--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD CONSTRAINT "bookings_code_unique" UNIQUE("code");--> statement-breakpoint
ALTER TABLE "bookmi"."services" ADD COLUMN "type" text DEFAULT 'booking' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmi"."services" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "bookmi"."services" AS s SET "slug" = numbered.slug FROM (
  SELECT id, CASE WHEN rn = 1 THEN base_slug ELSE base_slug || '-' || rn END AS slug
  FROM (
    SELECT id, host_id,
      COALESCE(NULLIF(regexp_replace(regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''), 'service') AS base_slug,
      row_number() OVER (PARTITION BY host_id, regexp_replace(regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g') ORDER BY created_at, id) AS rn
    FROM "bookmi"."services"
  ) t
) AS numbered WHERE s.id = numbered.id;--> statement-breakpoint
ALTER TABLE "bookmi"."services" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "svc_host_slug_uniq" ON "bookmi"."services" USING btree ("host_id","slug");--> statement-breakpoint
ALTER TABLE "bookmi"."services" ADD CONSTRAINT "svc_type_check" CHECK ("type" IN ('booking','tip'));--> statement-breakpoint
CREATE TABLE "bookmi"."customers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"host_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"email" text,
	"notes" text,
	"total_bookings" integer DEFAULT 0 NOT NULL,
	"total_spent_kobo" bigint DEFAULT 0 NOT NULL,
	"first_booking_at" timestamp with time zone,
	"last_booking_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "bookmi"."customers" ADD CONSTRAINT "customers_host_id_host_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "bookmi"."host_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cust_host_idx" ON "bookmi"."customers" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cust_host_phone_uniq" ON "bookmi"."customers" USING btree ("host_id","phone") WHERE "bookmi"."customers"."phone" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cust_host_name_idx" ON "bookmi"."customers" USING btree ("host_id","name");--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "bookmi"."customers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "refunded_amount_kobo" bigint;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "refunded_at" timestamp with time zone;