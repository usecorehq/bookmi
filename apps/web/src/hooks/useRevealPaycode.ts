import { useMutation } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";

/**
 * GET /hosts/me/wallet/paycodes/:id/reveal
 *
 * Returns the unmasked, redeemable code — gated by its own OTP purpose
 * (`reveal_paycode`), a second re-auth beyond the one that gated creation.
 * Never cached/persisted client-side beyond the component that displays it.
 */
export function useRevealPaycode() {
  return useMutation({
    mutationFn: async ({ paycodeId, otpCode }: { paycodeId: string; otpCode: string }) => {
      return apiFetch<{ clearPaycode: string }>(`/hosts/me/wallet/paycodes/${paycodeId}/reveal`, {
        headers: { "X-OTP-Code": otpCode },
      });
    },
  });
}
