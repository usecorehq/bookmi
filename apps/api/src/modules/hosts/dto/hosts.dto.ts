import { createZodDto } from "nestjs-zod";
import { z } from "zod";

// ─── Reserved words + slug rules ────────────────────────────────────────

export const RESERVED_SLUGS = new Set<string>([
  "admin",
  "api",
  "auth",
  "app",
  "dashboard",
  "docs",
  "help",
  "login",
  "logout",
  "onboarding",
  "pricing",
  "public",
  "settings",
  "signup",
  "static",
  "support",
  "www",
  "book",
  "bookings",
  "profile",
  "services",
  "wallet",
]);

/** Lowercase, 3–30 chars, starts + ends alphanumeric, hyphens allowed inside. */
export const SlugSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/, "Slug must be 3–30 lowercase alphanumeric characters or hyphens.")
  .refine((s) => !RESERVED_SLUGS.has(s), "That slug is reserved.");

// ─── Operating hours ───────────────────────────────────────────────────

const DayHoursSchema = z.object({
  open: z.string().regex(/^\d{2}:\d{2}$/, "open must be HH:mm"),
  close: z.string().regex(/^\d{2}:\d{2}$/, "close must be HH:mm"),
  closed: z.boolean(),
});

export const OperatingHoursSchema = z.object({
  monday: DayHoursSchema,
  tuesday: DayHoursSchema,
  wednesday: DayHoursSchema,
  thursday: DayHoursSchema,
  friday: DayHoursSchema,
  saturday: DayHoursSchema,
  sunday: DayHoursSchema,
});

// ─── Profile ───────────────────────────────────────────────────────────

/** POST /hosts/me/profile — called once after signup, upsert-style. */
export const CreateHostProfileSchema = z
  .object({
    slug: SlugSchema,
    displayName: z.string().min(1).max(80),
  })
  .strict();
export class CreateHostProfileDto extends createZodDto(CreateHostProfileSchema) {}

/** PATCH /hosts/me/profile — partial update. Also accepts bank details (splits into host_wallets). */
export const UpdateHostProfileSchema = z
  .object({
    slug: SlugSchema.optional(),
    displayName: z.string().min(1).max(80).optional(),
    bio: z.string().max(500).nullable().optional(),
    avatarUrl: z.string().url().nullable().optional(),
    accentColor: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .nullable()
      .optional(),
    operatingHours: OperatingHoursSchema.optional(),
    phone: z.string().max(40).nullable().optional(),
    address: z.string().max(200).nullable().optional(),
    bankCode: z.string().max(10).nullable().optional(),
    bankAccountNumber: z.string().max(20).nullable().optional(),
    bankAccountName: z.string().max(80).nullable().optional(),
  })
  .strict();
export class UpdateHostProfileDto extends createZodDto(UpdateHostProfileSchema) {}

// ─── Services ──────────────────────────────────────────────────────────

const ServiceBase = {
  title: z.string().min(1).max(120),
  description: z.string().max(500).nullable().optional(),
  priceKobo: z.number().int().nonnegative(),
  durationMinutes: z.number().int().positive().max(24 * 60).nullable().optional(),
  payWhatYouWant: z.boolean().optional(),
  active: z.boolean().optional(),
};

export const CreateServiceSchema = z.object(ServiceBase).strict();
export class CreateServiceDto extends createZodDto(CreateServiceSchema) {}

export const UpdateServiceSchema = z
  .object({
    title: ServiceBase.title.optional(),
    description: ServiceBase.description,
    priceKobo: ServiceBase.priceKobo.optional(),
    durationMinutes: ServiceBase.durationMinutes,
    payWhatYouWant: ServiceBase.payWhatYouWant,
    active: ServiceBase.active,
  })
  .strict();
export class UpdateServiceDto extends createZodDto(UpdateServiceSchema) {}

// ─── Bookings ──────────────────────────────────────────────────────────

export const BOOKING_STATUSES = [
  "pending",
  "confirmed",
  "canceled",
  "failed",
  "arrived",
  "seated",
  "completed",
  "no_show",
] as const;

export const BOOKING_SOURCES = ["storefront", "dashboard"] as const;

export const ListBookingsQuerySchema = z
  .object({
    status: z.enum(BOOKING_STATUSES).optional(),
    source: z.enum(BOOKING_SOURCES).optional(),
    from: z.string().datetime().optional(),
    to: z.string().datetime().optional(),
    q: z.string().max(80).optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  })
  .strict();
export class ListBookingsQueryDto extends createZodDto(ListBookingsQuerySchema) {}

/** POST /hosts/me/bookings — manual entry from the dashboard "+ New Booking" modal. */
export const CreateHostBookingSchema = z
  .object({
    serviceIds: z.array(z.string().uuid()).min(0),
    durationMinutes: z.number().int().positive().max(24 * 60),
    customerName: z.string().min(1).max(120),
    customerPhone: z.string().min(1).max(40),
    customerEmail: z.string().email().optional().or(z.literal("")),
    customerNotes: z.string().max(500).optional(),
    slotStartAt: z.string().datetime(),
    amountKobo: z.number().int().nonnegative().optional(),
  })
  .strict();
export class CreateHostBookingDto extends createZodDto(CreateHostBookingSchema) {}

/** PATCH /hosts/me/bookings/:id — status transitions. */
export const UpdateHostBookingSchema = z
  .object({
    status: z.enum(BOOKING_STATUSES).optional(),
    customerNotes: z.string().max(500).nullable().optional(),
  })
  .strict();
export class UpdateHostBookingDto extends createZodDto(UpdateHostBookingSchema) {}
