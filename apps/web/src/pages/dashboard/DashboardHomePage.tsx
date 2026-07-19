import { useState } from "react";
import { Link } from "react-router-dom";
import {
  Copy,
  Check,
  Share2,
  ArrowUpRight,
  Coffee,
  Wallet as WalletIcon,
  CalendarDays,
  TrendingUp,
} from "lucide-react";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useHostWallet } from "@/hooks/useHostWallet";
import { useHostBookings } from "@/hooks/useHostBookings";
import { formatNaira } from "@/lib/utils";

export default function DashboardHomePage() {
  const { profile } = useAuth();
  const walletQ = useHostWallet();
  const bookingsQ = useHostBookings({ limit: 5 });

  const walletBalance = walletQ.data?.wallet.balanceKobo ?? 0;
  const recentBookings = bookingsQ.data ?? [];

  // 30-day KPIs from the last 100 rows in the wallet response (recentBookings).
  // Cheap enough for MVP; a dedicated /kpi endpoint is a v1.1.
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const recentThirty = (walletQ.data?.recentBookings ?? []).filter(
    (b) => new Date(b.createdAt).getTime() >= thirtyDaysAgo,
  );
  const earnings30d = recentThirty
    .filter((b) => b.status === "confirmed" || b.status === "completed")
    .reduce((s, b) => s + b.netToHostKobo, 0);
  const bookings30d = recentThirty.length;

  return (
    <div>
      <PageHeader
        title={`Welcome, ${firstName(profile?.displayName)}`}
        subtitle="Here's what's happening on your Bookmi page."
      />

      {/* KPI row */}
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
          hint="After fees, from confirmed + completed"
        />
        <StatCard
          icon={<CalendarDays className="w-5 h-5" />}
          label="Bookings · 30 days"
          value={String(bookings30d)}
          hint="Any status"
        />
      </div>

      {/* Share card */}
      {profile?.slug && <ShareCard slug={profile.slug} />}

      {/* Recent bookings */}
      <div className="card p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Recent bookings</h2>
          <Link
            to="/dashboard/bookings"
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            See all <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {bookingsQ.isPending ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : recentBookings.length === 0 ? (
          <div className="text-sm text-muted-foreground">
            No bookings yet. Share your page to get started.
          </div>
        ) : (
          <ul className="divide-y divide-gray-200">
            {recentBookings.map((b) => {
              const isTip = !b.slotStartAt;
              return (
                <li key={b.id} className="py-3 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate">{b.customerName}</span>
                      {isTip && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-amber-50 text-amber-800">
                          <Coffee className="w-3 h-3" />
                          Tip
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {b.code ? `#${b.code} · ` : ""}
                      {b.slotStartAt
                        ? new Date(b.slotStartAt).toLocaleString()
                        : new Date(b.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-medium">{formatNaira(b.amountKobo)}</div>
                    <StatusPill status={b.status} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

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
  const label = status.replace("_", " ");
  const cls = STATUS_STYLE[status] ?? "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  confirmed: "bg-primary-light text-primary",
  arrived: "bg-blue-50 text-blue-700",
  seated: "bg-blue-50 text-blue-700",
  completed: "bg-green-50 text-green-700",
  canceled: "bg-gray-100 text-gray-500",
  failed: "bg-red-50 text-red-700",
  no_show: "bg-gray-100 text-gray-500",
};

function firstName(fullName?: string | null) {
  if (!fullName) return "there";
  return fullName.split(/\s+/)[0];
}
