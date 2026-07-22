import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AlertCircle, ChevronLeft, ChevronRight, X } from "lucide-react";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { useTransactions, TRANSACTIONS_PAGE_SIZE, type TransactionFilters } from "@/hooks/useTransactions";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatNaira } from "@/lib/utils";
import type { WalletLedgerEntry } from "@bookmi/shared-types";

const TYPE_OPTIONS = [
  { value: "", label: "All types" },
  { value: "credit", label: "Fund in (credit)" },
  { value: "debit", label: "Money out (debit)" },
] as const;

const SOURCE_MODE_OPTIONS = [
  { value: "", label: "All sources" },
  { value: "booking", label: "Booking" },
  { value: "tip", label: "Tip" },
  { value: "withdrawal", label: "Withdrawal" },
  { value: "refund", label: "Refund" },
  { value: "wallet_topup", label: "Wallet top-up" },
  { value: "paycode_redemption", label: "Paycode" },
] as const;

const STATUS_OPTIONS = [
  { value: "", label: "All statuses" },
  { value: "pending", label: "Pending" },
  { value: "success", label: "Success" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
] as const;

const SOURCE_MODE_LABELS: Record<string, string> = {
  booking: "Booking",
  tip: "Tip",
  withdrawal: "Withdrawal",
  refund: "Refund",
  wallet_topup: "Wallet top-up",
  paycode_redemption: "Paycode",
};

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  success: "bg-green-50 text-green-700",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

/** Values a select is allowed to take — everything but the leading "All …" option. */
const TYPE_VALUES = TYPE_OPTIONS.map((o) => o.value).filter(Boolean);
const SOURCE_MODE_VALUES = SOURCE_MODE_OPTIONS.map((o) => o.value).filter(Boolean);
const STATUS_VALUES = STATUS_OPTIONS.map((o) => o.value).filter(Boolean);

const FILTER_PARAM_KEYS = ["type", "sourceMode", "status"] as const;

/** Never trust a hand-edited or stale URL — fall back to "no filter" instead of sending a bad enum to the API. */
function sanitize<T extends string>(value: string | null, allowed: T[]): T | undefined {
  return value && (allowed as string[]).includes(value) ? (value as T) : undefined;
}

/**
 * Filters live in the URL, not just component state — "See all" links from
 * WalletPage (e.g. `?sourceMode=booking` for recent inflows,
 * `?sourceMode=withdrawal` for recent payouts) land here pre-filtered, and
 * the filter bar keeps the URL in sync so the view is bookmarkable/shareable
 * and survives a refresh.
 */
export default function TransactionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [page, setPage] = useState(1);

  const filters: TransactionFilters = useMemo(
    () => ({
      type: sanitize(searchParams.get("type"), TYPE_VALUES) as TransactionFilters["type"],
      sourceMode: sanitize(
        searchParams.get("sourceMode"),
        SOURCE_MODE_VALUES,
      ) as TransactionFilters["sourceMode"],
      status: sanitize(searchParams.get("status"), STATUS_VALUES) as TransactionFilters["status"],
    }),
    [searchParams],
  );
  const hasActiveFilters = FILTER_PARAM_KEYS.some((key) => searchParams.get(key));
  // Single source of truth for "the filters changed, go back to page 1" —
  // covers the filter selects AND a fresh `?sourceMode=…` navigation from
  // WalletPage's "See all" links landing on an already-mounted instance of
  // this page (e.g. clicking one See-all link, then the other, without a
  // full page reload in between).
  const filterKey = FILTER_PARAM_KEYS.map((key) => searchParams.get(key) ?? "").join("|");
  useEffect(() => {
    setPage(1);
  }, [filterKey]);

  const query = useTransactions(page, filters);
  const total = query.data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / TRANSACTIONS_PAGE_SIZE));

  const updateFilter = (patch: Partial<TransactionFilters>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(patch)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    });
  };

  const resetFilters = () => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      for (const key of FILTER_PARAM_KEYS) next.delete(key);
      return next;
    });
  };

  return (
    <div>
      <PageHeader
        title="Transactions"
        subtitle="Statement of account — every credit and debit against your wallet, fees included."
      />

      <div className="card p-4 mb-4 flex flex-wrap items-end gap-3">
        <FilterSelect
          label="Type"
          value={filters.type ?? ""}
          options={TYPE_OPTIONS}
          onChange={(v) => updateFilter({ type: (v || undefined) as TransactionFilters["type"] })}
        />
        <FilterSelect
          label="Source"
          value={filters.sourceMode ?? ""}
          options={SOURCE_MODE_OPTIONS}
          onChange={(v) =>
            updateFilter({ sourceMode: (v || undefined) as TransactionFilters["sourceMode"] })
          }
        />
        <FilterSelect
          label="Status"
          value={filters.status ?? ""}
          options={STATUS_OPTIONS}
          onChange={(v) => updateFilter({ status: (v || undefined) as TransactionFilters["status"] })}
        />
        {hasActiveFilters && (
          <button
            type="button"
            onClick={resetFilters}
            className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1 !py-1.5"
          >
            <X className="w-3.5 h-3.5" /> Reset filters
          </button>
        )}
      </div>

      {query.isPending ? (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-medium">Date</th>
                  <th className="px-4 py-3 font-medium">Source</th>
                  <th className="px-4 py-3 font-medium">Memo</th>
                  <th className="px-4 py-3 font-medium text-right">Amount</th>
                  <th className="px-4 py-3 font-medium text-right">Balance before</th>
                  <th className="px-4 py-3 font-medium text-right">Balance after</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {Array.from({ length: 5 }, (_, i) => (
                  <TransactionRowSkeleton key={i} />
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-gray-200 bg-gray-50">
            <Skeleton className="h-3 w-32" />
            <div className="flex items-center gap-2">
              <div className="btn-secondary !py-1.5 !px-2.5 opacity-40">
                <ChevronLeft className="w-4 h-4" />
              </div>
              <div className="btn-secondary !py-1.5 !px-2.5 opacity-40">
                <ChevronRight className="w-4 h-4" />
              </div>
            </div>
          </div>
        </div>
      ) : query.isError || !query.data ? (
        <div className="card p-6 flex items-start gap-3 border-red-200 bg-red-50">
          <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
          <div className="text-sm text-red-700">Couldn't load transactions. Try refreshing.</div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          {query.data.items.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">No transactions match these filters.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="px-4 py-3 font-medium">Date</th>
                    <th className="px-4 py-3 font-medium">Source</th>
                    <th className="px-4 py-3 font-medium">Memo</th>
                    <th className="px-4 py-3 font-medium text-right">Amount</th>
                    <th className="px-4 py-3 font-medium text-right">Balance before</th>
                    <th className="px-4 py-3 font-medium text-right">Balance after</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {query.data.items.map((entry) => (
                    <TransactionRow key={entry.id} entry={entry} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div className="flex items-center justify-between gap-4 px-4 py-3 border-t border-gray-200 bg-gray-50">
            <div className="text-xs text-muted-foreground">
              {total === 0 ? "0 results" : `Page ${page} of ${totalPages} · ${total} total`}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="btn-secondary !py-1.5 !px-2.5 disabled:opacity-40"
                aria-label="Previous page"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="btn-secondary !py-1.5 !px-2.5 disabled:opacity-40"
                aria-label="Next page"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterSelect<T extends readonly { value: string; label: string }[]>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: T;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm">
      <span className="block text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</span>
      <select
        className="input-field !py-1.5"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function TransactionRowSkeleton() {
  return (
    <tr>
      <td className="px-4 py-3">
        <Skeleton className="h-3 w-24" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-3 w-20" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-3 w-36" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton className="h-3 w-16 ml-auto" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton className="h-3 w-16 ml-auto" />
      </td>
      <td className="px-4 py-3 text-right">
        <Skeleton className="h-3 w-16 ml-auto" />
      </td>
      <td className="px-4 py-3">
        <Skeleton className="h-4 w-16" />
      </td>
    </tr>
  );
}

function TransactionRow({ entry }: { entry: WalletLedgerEntry }) {
  const isCredit = entry.type === "credit";
  const sign = isCredit ? "+" : "−";
  const amountClass = isCredit ? "text-green-700" : "text-red-700";
  const sourceLabel = SOURCE_MODE_LABELS[entry.sourceMode] ?? entry.sourceMode;

  return (
    <tr>
      <td className="px-4 py-3 whitespace-nowrap text-muted-foreground">
        {new Date(entry.createdAt).toLocaleString()}
      </td>
      <td className="px-4 py-3 whitespace-nowrap font-medium">{sourceLabel}</td>
      <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{entry.memo ?? "—"}</td>
      <td className={`px-4 py-3 text-right font-medium whitespace-nowrap ${amountClass}`}>
        {sign}
        {formatNaira(entry.amountKobo)}
      </td>
      <td className="px-4 py-3 text-right text-muted-foreground whitespace-nowrap">
        {formatNaira(entry.balanceBeforeKobo)}
      </td>
      <td className="px-4 py-3 text-right whitespace-nowrap">{formatNaira(entry.balanceAfterKobo)}</td>
      <td className="px-4 py-3 whitespace-nowrap">
        <span
          className={`inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
            STATUS_STYLE[entry.status] ?? "bg-gray-100 text-gray-700"
          }`}
        >
          {entry.status}
        </span>
      </td>
    </tr>
  );
}
