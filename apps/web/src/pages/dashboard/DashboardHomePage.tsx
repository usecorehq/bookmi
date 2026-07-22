import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Copy,
  Check,
  Share2,
  ArrowUpRight,
  Wallet as WalletIcon,
  CalendarDays,
  TrendingUp,
  Coffee,
  Ticket,
  RefreshCcw,
  Banknote,
  Landmark,
  Receipt,
} from "lucide-react";
import type {
  DailyGrossBucket,
  WalletLedgerEntry,
} from "@bookmi/shared-types";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useHostWallet } from "@/hooks/useHostWallet";
import { useDailyGross, useLedger } from "@/hooks/useLedger";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatNaira } from "@/lib/utils";

export default function DashboardHomePage() {
  const { profile } = useAuth();
  const walletQ = useHostWallet();
  const ledgerQ = useLedger({ limit: 10 });
  const dailyQ = useDailyGross(30);

  const walletBalance = walletQ.data?.wallet.balanceKobo ?? 0;
  const buckets = dailyQ.data ?? [];
  const ledger = ledgerQ.data ?? [];

  // 30-day earnings straight off the chart data — sum of every booking +
  // tip credit inside the window. Matches what the bars show, so the KPI
  // and the chart tell the same story.
  const bookingKobo30d = buckets.reduce((s, b) => s + b.bookingKobo, 0);
  const tipKobo30d = buckets.reduce((s, b) => s + b.tipKobo, 0);
  const earnings30d = bookingKobo30d + tipKobo30d;
  const inflows30d = buckets.reduce(
    (s, b) => s + (b.bookingKobo > 0 ? 1 : 0) + (b.tipKobo > 0 ? 1 : 0),
    0,
  );

  return (
    <div>
      <PageHeader
        title={`Welcome, ${firstName(profile?.displayName)}`}
        subtitle="Here's what's happening on your Bookmi page."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon={<WalletIcon className="w-5 h-5" />}
          label="Wallet balance"
          value={formatNaira(walletBalance)}
          hint="Ready to withdraw"
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Earnings · 30 days"
          value={formatNaira(earnings30d)}
          hint={`Bookings ${formatNaira(bookingKobo30d)} · Tips ${formatNaira(tipKobo30d)}`}
        />
        <StatCard
          icon={<CalendarDays className="w-5 h-5" />}
          label="Active days · 30d"
          value={String(inflows30d)}
          hint="Days with any inflow"
        />
      </div>

      {profile?.slug && <ShareCard slug={profile.slug} />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <RecentTransactionsCard
          rows={ledger}
          isPending={ledgerQ.isPending}
        />
        <DailyGrossChartCard
          buckets={buckets}
          isPending={dailyQ.isPending}
        />
      </div>
    </div>
  );
}

// ─── Recent transactions (LHS) ────────────────────────────────────────

function RecentTransactionsCard({
  rows,
  isPending,
}: {
  rows: WalletLedgerEntry[];
  isPending: boolean;
}) {
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4 gap-2">
        <h2 className="text-lg font-semibold">
          Recent transactions
          {rows.length > 0 && (
            <span className="text-muted-foreground font-normal"> · {rows.length}</span>
          )}
        </h2>
        <Link
          to="/dashboard/wallet"
          className="text-sm text-primary hover:underline inline-flex items-center gap-1 shrink-0"
        >
          Open wallet <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      {isPending ? (
        <ul className="divide-y divide-gray-200">
          {Array.from({ length: 5 }, (_, i) => (
            <LedgerRowSkeleton key={i} />
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">
          No transactions yet. Share your page to get started.
        </div>
      ) : (
        <ul className="divide-y divide-gray-200">
          {rows.map((e) => (
            <LedgerRow key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </div>
  );
}

function LedgerRowSkeleton() {
  return (
    <li className="py-3 flex items-center gap-3">
      <Skeleton className="w-9 h-9 shrink-0 rounded-full" />
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex items-center gap-2">
          <Skeleton className="h-3.5 w-24" />
          <Skeleton className="h-3.5 w-14" />
        </div>
        <Skeleton className="h-3 w-40" />
      </div>
      <div className="text-right shrink-0 space-y-1.5">
        <Skeleton className="h-3.5 w-16 ml-auto" />
        <Skeleton className="h-3 w-14 ml-auto" />
      </div>
    </li>
  );
}

function LedgerRow({ entry }: { entry: WalletLedgerEntry }) {
  const meta = MODE_META[entry.sourceMode];
  const isCredit = entry.type === "credit";
  return (
    <li className="py-3 flex items-center gap-3">
      <span
        className={`w-9 h-9 shrink-0 flex items-center justify-center ${
          isCredit ? "bg-primary-light text-primary" : "bg-gray-100 text-gray-600"
        }`}
      >
        {meta.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{meta.label}</span>
          <StatusPill status={entry.status} />
        </div>
        <div className="text-xs text-muted-foreground truncate mt-0.5">
          {entry.memo ?? meta.fallbackMemo} · {new Date(entry.createdAt).toLocaleString()}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div
          className={`text-sm font-medium ${
            isCredit ? "text-green-700" : "text-gray-900"
          }`}
        >
          {isCredit ? "+" : "−"}
          {formatNaira(entry.amountKobo)}
        </div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide">
          Bal {formatNaira(entry.balanceAfterKobo)}
        </div>
      </div>
    </li>
  );
}

// ─── 30-day bar chart (RHS) ───────────────────────────────────────────

function DailyGrossChartCard({
  buckets,
  isPending,
}: {
  buckets: DailyGrossBucket[];
  isPending: boolean;
}) {
  const realMaxKobo = useMemo(
    () => buckets.reduce((m, b) => Math.max(m, b.bookingKobo + b.tipKobo), 0),
    [buckets],
  );

  const isMock = realMaxKobo === 0;

  const chartBuckets = useMemo(() => {
    if (!isMock) return buckets;
    // Generate 30 days of mock data
    return Array.from({ length: 30 }, (_, i) => {
      const dateObj = new Date();
      dateObj.setDate(dateObj.getDate() - (29 - i));
      const dateStr = dateObj.toISOString().split("T")[0]!;

      // Make a nice realistic variance
      const isWeekend = i % 7 === 5 || i % 7 === 6;
      let bookingKobo = 0;
      if (isWeekend) {
        bookingKobo = i % 3 === 0 ? 3600000 : i % 3 === 1 ? 1200000 : 0;
      } else {
        bookingKobo = i % 5 === 2 ? 2400000 : i % 5 === 4 ? 1200000 : 0;
      }
      const tipKobo = bookingKobo > 0 && i % 4 === 1 ? 500000 : 0;

      return {
        date: dateStr,
        bookingKobo,
        tipKobo,
      };
    });
  }, [buckets, isMock]);

  const maxKobo = useMemo(
    () => chartBuckets.reduce((m, b) => Math.max(m, b.bookingKobo + b.tipKobo), 0),
    [chartBuckets],
  );

  const totalKobo = isMock ? 0 : buckets.reduce((s, b) => s + b.bookingKobo + b.tipKobo, 0);

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4 gap-2">
        <div>
          <h2 className="text-lg font-semibold">Earnings · 30 days</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Bookings + tips per day. Total {formatNaira(totalKobo)}.
          </p>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-primary" /> Bookings
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="w-2.5 h-2.5 bg-amber-400" /> Tips
          </span>
        </div>
      </div>

      {isPending ? (
        <div className="h-40 flex items-end gap-[3px]" aria-hidden>
          {Array.from({ length: 30 }, (_, i) => (
            <Skeleton
              key={i}
              className="flex-1 h-full rounded-none"
              style={{ height: `${20 + ((i * 37) % 70)}%` }}
            />
          ))}
        </div>
      ) : (
        <div className="relative">
          <div
            className={`h-40 flex items-end gap-[3px] ${
              isMock ? "opacity-25 grayscale desaturate pointer-events-none select-none" : ""
            }`}
            role="img"
            aria-label="Daily earnings for the last 30 days"
          >
            {chartBuckets.map((b) => {
              const total = b.bookingKobo + b.tipKobo;
              const totalH = maxKobo > 0 ? Math.max(2, (total / maxKobo) * 100) : 0;
              const bookingRatio = total > 0 ? b.bookingKobo / total : 0;
              const tipRatio = total > 0 ? b.tipKobo / total : 0;
              return (
                <div
                  key={b.date}
                  className="flex-1 h-full flex flex-col justify-end group relative"
                  title={`${formatShortDate(b.date)} · ${formatNaira(total)}`}
                >
                  <div
                    className="w-full flex flex-col overflow-hidden"
                    style={{ height: `${totalH}%` }}
                  >
                    <div
                      className="w-full bg-amber-400"
                      style={{ height: `${tipRatio * 100}%` }}
                    />
                    <div
                      className="w-full bg-primary"
                      style={{ height: `${bookingRatio * 100}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>

          {isMock && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <span className="bg-white/95 border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 shadow-sm rounded-md">
                No earnings in the last 30 days yet.
              </span>
            </div>
          )}
        </div>
      )}
      {!isPending && chartBuckets.length > 0 && (
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>{formatShortDate(chartBuckets[0]!.date)}</span>
          <span>{formatShortDate(chartBuckets[chartBuckets.length - 1]!.date)}</span>
        </div>
      )}
    </div>
  );
}

// ─── shared bits ──────────────────────────────────────────────────────

interface ModeMeta {
  label: string;
  icon: React.ReactNode;
  fallbackMemo: string;
}
const MODE_META: Record<WalletLedgerEntry["sourceMode"], ModeMeta> = {
  booking: {
    label: "Booking payment",
    icon: <Ticket className="w-4 h-4" />,
    fallbackMemo: "Booking",
  },
  tip: {
    label: "Tip",
    icon: <Coffee className="w-4 h-4" />,
    fallbackMemo: "Tip",
  },
  withdrawal: {
    label: "Withdrawal",
    icon: <Banknote className="w-4 h-4" />,
    fallbackMemo: "Withdrawal to bank",
  },
  refund: {
    label: "Refund",
    icon: <RefreshCcw className="w-4 h-4" />,
    fallbackMemo: "Customer refund",
  },
  wallet_topup: {
    label: "Wallet top-up",
    icon: <Landmark className="w-4 h-4" />,
    fallbackMemo: "Bank transfer to reserved account",
  },
  paycode_redemption: {
    label: "Paycode",
    icon: <Receipt className="w-4 h-4" />,
    fallbackMemo: "Offline payout paycode",
  },
};

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      <div className="text-xs text-muted-foreground mt-1">{hint}</div>
    </div>
  );
}

function ShareCard({ slug }: { slug: string }) {
  const url = `${window.location.origin}/${slug}`;
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="card p-6 bg-primary text-white">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-2 opacity-80">
            <Share2 className="w-4 h-4" />
            <span className="text-xs font-medium uppercase tracking-wide">Your Bookmi link</span>
          </div>
          <div className="text-2xl font-bold">book.me/{slug}</div>
          <p className="text-sm opacity-80 mt-1">
            Share this link anywhere. Anyone can book + pay.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={handleCopy}
            className="btn-secondary !bg-white !text-primary"
          >
            {copied ? (
              <>
                <Check className="w-4 h-4" /> Copied
              </>
            ) : (
              <>
                <Copy className="w-4 h-4" /> Copy link
              </>
            )}
          </button>
          <a
            href={`/${slug}`}
            target="_blank"
            rel="noreferrer"
            className="btn-secondary !bg-white !text-primary"
          >
            Open <ArrowUpRight className="w-4 h-4" />
          </a>
        </div>
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  if (status === "success") return null;
  const label = status.replace("_", " ");
  const cls = STATUS_STYLE[status] ?? "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-block px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  failed: "bg-red-50 text-red-700",
  cancelled: "bg-gray-100 text-gray-500",
};

function firstName(fullName?: string | null) {
  if (!fullName) return "there";
  return fullName.split(/\s+/)[0];
}

function formatShortDate(iso: string) {
  // buckets are YYYY-MM-DD; render as e.g. "Jul 20"
  const parts = iso.split("-").map(Number);
  const y = parts[0] ?? new Date().getFullYear();
  const m = parts[1] ?? 1;
  const d = parts[2] ?? 1;
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

