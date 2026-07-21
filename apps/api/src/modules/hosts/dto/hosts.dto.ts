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

export const SERVICE_TYPES = ["booking", "tip"] as const;
export type ServiceType = (typeof SERVICE_TYPES)[number];

/**
 * A service's slug is per-host, so it can share the same regex as the host
 * slug but is exempt from RESERVED_SLUGS (those apply to the top-level path).
 */
export const ServiceSlugSchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{1,58}[a-z0-9])?$/,
    "Slug must be 3–60 lowercase alphanumeric characters or hyphens.",
  );

const ServiceBase = {
  type: z.enum(SERVICE_TYPES).optional(),
  slug: ServiceSlugSchema.optional(),
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
    type: ServiceBase.type,
    slug: ServiceBase.slug,
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

// ─── Wallet — bank verification + payout account ───────────────────────

/** POST /hosts/me/wallet/verify-bank-account — resolve account name via provider. */
export const VerifyBankAccountSchema = z
  .object({
    bankCode: z.string().min(1).max(10),
    accountNumber: z
      .string()
      .regex(/^\d{10}$/, "Account number must be 10 digits"),
  })
  .strict();
export class VerifyBankAccountDto extends createZodDto(VerifyBankAccountSchema) {}

/** POST /hosts/me/wallet/payout-account — persist the verified triple. */
export const SavePayoutAccountSchema = z
  .object({
    bankCode: z.string().min(1).max(10),
    accountNumber: z
      .string()
      .regex(/^\d{10}$/, "Account number must be 10 digits"),
    accountName: z.string().min(1).max(120),
  })
  .strict();
export class SavePayoutAccountDto extends createZodDto(SavePayoutAccountSchema) {}

// ─── Refund ────────────────────────────────────────────────────────────

/**
 * POST /hosts/me/bookings/:id/refund — sends money back to the customer's
 * bank account and debits the host wallet. `accountName` is what the client
 * saw after auto-verify; the server re-resolves it against the provider and
 * bounces the request on a mismatch.
 *
 * The client MUST also send `x-idempotency-key` and `x-otp-code` headers
 * (enforced at the controller layer). The idempotency key anchors the
 * refund row so a retried request lands on the cached response rather than
 * a second disbursement.
 */
export const RefundBookingSchema = z
  .object({
    bankCode: z.string().min(1).max(10),
    accountNumber: z
      .string()
      .regex(/^\d{10}$/, "Account number must be 10 digits"),
    accountName: z.string().min(1).max(120),
    amountKobo: z.number().int().positive(),
    reason: z.string().max(500).optional(),
  })
  .strict();
export class RefundBookingDto extends createZodDto(RefundBookingSchema) {}

// ─── Withdraw ──────────────────────────────────────────────────────────

/**
 * POST /hosts/me/wallet/withdraw — pay the host from their wallet to the
 * saved payout account. Amount is in the body; destination + OTP + idempotency
 * key are read from headers so the request shape mirrors refund.
 */
export const WithdrawSchema = z
  .object({
    amountKobo: z.number().int().positive(),
  })
  .strict();
export class WithdrawDto extends createZodDto(WithdrawSchema) {}

// ─── Reserved account activation (MOCKED) ──────────────────────────────

/**
 * POST /hosts/me/wallet/activate-reserved-account — collects the host's BVN
 * and provisions a MOCKED Monnify reserved account (no real provider call;
 * see HostWalletService.activateReservedAccount). BVN is exactly 11 digits,
 * matching the real Monnify/NIBSS format.
 */
export const ActivateReservedAccountSchema = z
  .object({
    bvn: z.string().regex(/^\d{11}$/, "BVN must be 11 digits"),
  })
  .strict();
export class ActivateReservedAccountDto extends createZodDto(ActivateReservedAccountSchema) {}
