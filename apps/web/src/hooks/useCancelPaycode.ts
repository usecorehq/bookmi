import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Paycode } from "@bookmi/shared-types";
import { apiFetch } from "@/lib/api";

/**
 * DELETE /hosts/me/wallet/paycodes/:id
 *
 * Cancels a pending paycode and credits the hold back to the wallet. No
 * OTP — cancelling only returns money to the host's own balance.
 */
export function useCancelPaycode() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (paycodeId: string) => {
      return apiFetch<{ paycode: Paycode }>(`/hosts/me/wallet/paycodes/${paycodeId}`, {
        method: "DELETE",
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
