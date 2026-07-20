ALTER TABLE "bookmi"."bookings" ADD COLUMN "refunded_amount_kobo" bigint;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "refund_reason" text;--> statement-breakpoint
ALTER TABLE "bookmi"."bookings" ADD COLUMN "refunded_at" timestamp with time zone;