import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { HostWallet } from "@bookmi/shared-types";

export interface Bank {
  code: string;
  name: string;
  logoUrl?: string | null;
}

/**
 * Payout-form dropdown data. The API caches the list for 24h server-side; we
 * mirror that on the client so the dropdown stays open without refetching.
 */
export function useBanks() {
  return useQuery({
    queryKey: ["host-wallet-banks"],
    staleTime: 24 * 60 * 60 * 1000, // 24h — bank list rarely changes.
    queryFn: async () =>
      (await apiFetch<{ items: Bank[] }>("/hosts/me/wallet/banks")).items,
  });
}

export interface ResolvedAccount {
  accountName: string;
  bankName: string;
}

/**
 * Resolves an account holder's name for a (bankCode, accountNumber) pair.
 * Called on debounce inside PayoutSection — server rate-limiting handles the
 * concurrency floor for us.
 */
export function useResolveAccount() {
  return useMutation<ResolvedAccount, unknown, { bankCode: string; accountNumber: string }>({
    mutationFn: (input) =>
      apiFetch<ResolvedAccount>("/hosts/me/wallet/verify-bank-account", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}

/** Alias kept for symmetry with the naming in the design brief. */
export const useVerifyBankAccount = useResolveAccount;

/**
 * Persists the verified (bankCode, accountNumber, accountName) triple. Server
 * re-verifies on write, so a stale `accountName` client-side will bounce
 * with a 400.
 */
export function useSavePayoutAccount() {
  const queryClient = useQueryClient();
  return useMutation<
    HostWallet,
    unknown,
    { bankCode: string; accountNumber: string; accountName: string }
  >({
    mutationFn: async (input) => {
      const res = await apiFetch<{ wallet: HostWallet }>(
        "/hosts/me/wallet/payout-account",
        { method: "POST", body: JSON.stringify(input) },
      );
      return res.wallet;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["host-wallet"] });
    },
  });
}
