import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

/**
 * POST /api/hosts/me/security/otp/challenge
 *
 * Requests a fresh 6-digit OTP for a money-out operation. The API emails
 * the code to the host's Supabase-registered address; the response carries
 * only the challenge id + expiry — never the code itself.
 *
 * A 429 with a "Too many OTP requests" message means the per-hour rate
 * limit tripped. Surface as a toast at the call site.
 */
export type SecurityOtpPurpose =
  | "refund_booking"
  | "withdraw_funds"
  | "create_paycode"
  | "reveal_paycode";

export interface RequestOtpResponse {
  challengeId: string;
  expiresAt: string;
}

export function useRequestOtp() {
  return useMutation({
    mutationFn: async (purpose: SecurityOtpPurpose) => {
      return apiFetch<RequestOtpResponse>("/hosts/me/security/otp/challenge", {
        method: "POST",
        body: JSON.stringify({ purpose }),
      });
    },
  });
}
