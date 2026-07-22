import { createZodDto } from "nestjs-zod";
import { z } from "zod";

export const SECURITY_PURPOSES = [
  "refund_booking",
  "withdraw_funds",
  "create_paycode",
  "reveal_paycode",
] as const;
export type SecurityChallengePurpose = (typeof SECURITY_PURPOSES)[number];

/** POST /hosts/me/security/otp/challenge — mint a fresh OTP for a purpose. */
export const RequestOtpSchema = z
  .object({
    purpose: z.enum(SECURITY_PURPOSES),
  })
  .strict();
export class RequestOtpDto extends createZodDto(RequestOtpSchema) {}

export const OTP_CODE_REGEX = /^\d{6}$/;
