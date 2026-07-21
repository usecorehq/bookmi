import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { HostWallet } from "@bookmi/shared-types";
import { apiFetch } from "@/lib/api";

/**
 * POST /api/hosts/me/wallet/activate-reserved-account
 *
 * MOCKED activation — collects the host's BVN and provisions a fabricated
 * reserved account number + bank name (no real Monnify call happens
 * server-side). See HostWalletService.activateReservedAccount.
 */
export function useActivateReservedAccount() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ bvn }: { bvn: string }) => {
      const res = await apiFetch<{ wallet: HostWallet }>(
        "/hosts/me/wallet/activate-reserved-account",
        {
          method: "POST",
          body: JSON.stringify({ bvn }),
        },
      );
      return res.wallet;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["host-wallet"] });
    },
  });
}
