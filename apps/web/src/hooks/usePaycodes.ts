import { useQuery } from "@tanstack/react-query";
import type { Paycode } from "@bookmi/shared-types";
import { apiFetch } from "@/lib/api";

/**
 * GET /hosts/me/wallet/paycodes
 *
 * List of the host's offline-payout paycodes, newest first. The API
 * lazily reconciles any expired-but-unvisited ones before returning, so
 * this list is always up to date the moment it's read.
 */
export function usePaycodes() {
  return useQuery({
    queryKey: ["paycodes"],
    staleTime: 15_000,
    queryFn: async () =>
      (await apiFetch<{ items: Paycode[] }>("/hosts/me/wallet/paycodes")).items,
  });
}
