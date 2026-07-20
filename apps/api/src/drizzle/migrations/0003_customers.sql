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
);
--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "customer_id" uuid;--> statement-breakpoint
ALTER TABLE "bookmi"."customers" ADD CONSTRAINT "customers_host_id_host_profiles_id_fk" FOREIGN KEY ("host_id") REFERENCES "bookmi"."host_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cust_host_idx" ON "bookmi"."customers" USING btree ("host_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cust_host_phone_uniq" ON "bookmi"."customers" USING btree ("host_id","phone") WHERE "bookmi"."customers"."phone" IS NOT NULL;--> statement-breakpoint
CREATE INDEX "cust_host_name_idx" ON "bookmi"."customers" USING btree ("host_id","name");--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD CONSTRAINT "bookings_customer_id_customers_id_fk" FOREIGN KEY ("customer_id") REFERENCES "bookmi"."customers"("id") ON DELETE set null ON UPDATE no action;