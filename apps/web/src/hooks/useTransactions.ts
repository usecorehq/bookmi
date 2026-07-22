import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type {
  LedgerEntryStatus,
  LedgerEntryType,
  LedgerSourceMode,
  LedgerSourceType,
  WalletLedgerEntry,
} from "@bookmi/shared-types";

export const TRANSACTIONS_PAGE_SIZE = 10;

export interface TransactionFilters {
  type?: LedgerEntryType;
  sourceType?: LedgerSourceType;
  sourceMode?: LedgerSourceMode;
  status?: LedgerEntryStatus;
}

/**
 * Paginated + filtered statement of account, sourced from the same
 * immutable `wallet_ledger` the dashboard's small `useLedger` widget reads
 * — this hook just adds page/filter state on top of `GET /hosts/me/ledger`.
 * Page is 1-indexed; converted to `offset` here so the API keeps its
 * `limit`/`offset` house convention.
 */
export function useTransactions(page: number, filters: TransactionFilters) {
  const offset = (page - 1) * TRANSACTIONS_PAGE_SIZE;
  const params = new URLSearchParams({
    limit: String(TRANSACTIONS_PAGE_SIZE),
    offset: String(offset),
  });
  if (filters.type) params.set("type", filters.type);
  if (filters.sourceType) params.set("sourceType", filters.sourceType);
  if (filters.sourceMode) params.set("sourceMode", filters.sourceMode);
  if (filters.status) params.set("status", filters.status);

  return useQuery({
    queryKey: ["host-transactions", page, filters],
    staleTime: 15_000,
    queryFn: () =>
      apiFetch<{ items: WalletLedgerEntry[]; total: number }>(
        `/hosts/me/ledger?${params.toString()}`,
      ),
  });
}
