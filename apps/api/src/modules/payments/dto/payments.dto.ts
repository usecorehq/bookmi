import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const PURPOSE_TYPES = ["booking_checkout"] as const;

/**
 * Initiate a payment. The frontend sends this to /payments/initiate; the
 * server derives the reference, resolves the provider by country, calls
 * provider.initialize, and returns whatever the client needs to run the
 * checkout (popup access_code, hosted authorization_url, or just the
 * reference for Monnify popup).
 */
export const InitiatePaymentSchema = z
  .object({
    purposeType: z.enum(PURPOSE_TYPES),
    purposeId: z.string().uuid().optional(),
    amountMinor: z.number().int().positive(),
    currency: z.string().length(3).optional(),
    countryCode: z.string().length(2).optional(),
    businessId: z.string().uuid().optional(),
    email: z.string().email(),
    metadata: z.record(z.unknown()).optional(),
    callbackUrl: z.string().url().optional(),
    idempotencyKey: z.string().optional(),
    checkoutMode: z.enum(["popup", "checkout_url"]).optional(),
  })
  .strict();

export class InitiatePaymentDto extends createZodDto(InitiatePaymentSchema) {}
