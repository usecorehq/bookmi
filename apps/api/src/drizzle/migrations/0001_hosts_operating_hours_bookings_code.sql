ALTER TABLE "bookmi"."bookings" DROP CONSTRAINT "bookings_service_id_services_id_fk";
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
ALTER TABLE "bookmi"."bookings" ADD CONSTRAINT "bookings_code_unique" UNIQUE("code");