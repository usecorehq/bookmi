import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Paycode } from "@bookmi/shared-types";
import { apiFetch } from "@/lib/api";

/**
 * POST /hosts/me/wallet/paycodes
 *
 * Generates a paycode redeemable for cash at a Moniepoint POS agent —
 * debits the wallet exactly like a withdrawal. Amount + OTP code +
 * idempotency key are the only inputs; the returned `paycode` never
 * carries the clear/unmasked code — reveal it separately via
 * `useRevealPaycode`, gated by its own OTP purpose.
 */
export function useCreatePaycode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      amountKobo,
      idempotencyKey,
      otpCode,
    }: {
      amountKobo: number;
      idempotencyKey: string;
      otpCode: string;
    }) => {
      return apiFetch<{ paycode: Paycode; cached: boolean }>("/hosts/me/wallet/paycodes", {
        method: "POST",
        body: JSON.stringify({ amountKobo }),
        headers: {
          "X-Idempotency-Key": idempotencyKey,
          "X-OTP-Code": otpCode,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["paycodes"] });
      qc.invalidateQueries({ queryKey: ["host-wallet"] });
      qc.invalidateQueries({ queryKey: ["host-ledger"] });
      qc.invalidateQueries({ queryKey: ["host-transactions"] });
    },
  });
}
