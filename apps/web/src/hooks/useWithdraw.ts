import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Payout } from "@bookmi/shared-types";
import { apiFetch } from "@/lib/api";

/**
 * POST /api/hosts/me/wallet/withdraw
 *
 * Withdraws from the wallet to the host's saved payout account. The
 * destination bank details are NOT sent — the server reads them from
 * `host_wallets`, closing off "swap the destination" attacks. Amount + OTP
 * code + idempotency key are the only inputs.
 */
export function useWithdraw() {
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
      return apiFetch<{ payout: Payout }>("/hosts/me/wallet/withdraw", {
        method: "POST",
        body: JSON.stringify({ amountKobo }),
        headers: {
          "X-Idempotency-Key": idempotencyKey,
          "X-OTP-Code": otpCode,
        },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["host-wallet"] });
    },
  });
}
