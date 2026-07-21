import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { HostWallet } from "@bookmi/shared-types";
import { apiFetch } from "@/lib/api";

/**
 * POST /api/hosts/me/wallet/activate-reserved-account
 *
 * Activates the host's reserved account — collects the BVN and provisions a
 * dedicated account number + bank name. Server-side this calls the real
 * Monnify reserved-account API when MONNIFY_USE_RESERVED_ACCOUNT_API is on,
 * otherwise falls back to a mocked account. See
 * HostWalletService.activateReservedAccount.
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
