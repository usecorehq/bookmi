import { createZodDto } from "nestjs-zod";
import { z } from "zod";

/**
 * POST /api/public/:slug/:serviceSlug/checkout — for both bookings and tips.
 *
 * Booking rules (server-enforced):
 *   - `slotStartAt` required
 *   - `amountKobo` ignored for fixed-price services; required + must clear
 *     the floor for pay-what-you-want.
 *
 * Tip rules (server-enforced):
 *   - `slotStartAt` ignored (set null on the row).
 *   - `amountKobo` required, must be >= service.priceKobo (the minimum floor).
 */
export const PublicCheckoutSchema = z
  .object({
    customerName: z.string().min(1).max(120),
    customerEmail: z.string().email(),
    customerPhone: z.string().min(1).max(40).optional(),
    customerNotes: z.string().max(500).optional(),
    slotStartAt: z.string().datetime().optional(),
    amountKobo: z.number().int().positive().optional(),
  })
  .strict();
export class PublicCheckoutDto extends createZodDto(PublicCheckoutSchema) {}
