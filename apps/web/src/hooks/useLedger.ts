import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { DailyGrossBucket, WalletLedgerEntry } from "@bookmi/shared-types";

/**
 * Recent ledger entries for the dashboard "Recent transactions" panel.
 * Newest-first. Kobo-denominated throughout.
 */
export function useLedger(opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 10;
  return useQuery({
    queryKey: ["host-ledger", limit],
    staleTime: 30_000,
    queryFn: async () =>
      (
        await apiFetch<{ items: WalletLedgerEntry[] }>(
          `/hosts/me/ledger?limit=${limit}`,
        )
      ).items,
  });
}

/**
 * Daily gross booking + tip credits over the last N days for the dashboard
 * bar chart. Bucket dates are YYYY-MM-DD in UTC.
 */
export function useDailyGross(days = 30) {
  return useQuery({
    queryKey: ["host-ledger-daily-gross", days],
    staleTime: 60_000,
    queryFn: async () =>
      (
        await apiFetch<{ buckets: DailyGrossBucket[] }>(
          `/hosts/me/ledger/daily-gross?days=${days}`,
        )
      ).buckets,
  });
}
