ALTER TABLE "bookmi"."services" ADD COLUMN "type" text DEFAULT 'booking' NOT NULL;--> statement-breakpoint
ALTER TABLE "bookmi"."services" ADD COLUMN "slug" text;--> statement-breakpoint
UPDATE "bookmi"."services" AS s SET "slug" = numbered.slug FROM (
  SELECT
    id,
    CASE
      WHEN rn = 1 THEN base_slug
      ELSE base_slug || '-' || rn
    END AS slug
  FROM (
    SELECT
      id,
      host_id,
      COALESCE(
        NULLIF(regexp_replace(regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g'), ''),
        'service'
      ) AS base_slug,
      row_number() OVER (
        PARTITION BY host_id, regexp_replace(regexp_replace(lower(title), '[^a-z0-9]+', '-', 'g'), '(^-+|-+$)', '', 'g')
        ORDER BY created_at, id
      ) AS rn
    FROM "bookmi"."services"
  ) t
) AS numbered
WHERE s.id = numbered.id;--> statement-breakpoint
ALTER TABLE "bookmi"."services" ALTER COLUMN "slug" SET NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "svc_host_slug_uniq" ON "bookmi"."services" USING btree ("host_id","slug");--> statement-breakpoint
ALTER TABLE "bookmi"."services" ADD CONSTRAINT "svc_type_check" CHECK ("type" IN ('booking','tip'));
