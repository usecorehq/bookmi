import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Wallet as WalletIcon,
  TrendingUp,
  Clock,
  Copy,
  Check,
  ArrowUpRight,
  AlertCircle,
  Loader2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { useHostWallet, type WalletView } from "@/hooks/useHostWallet";
import { formatNaira } from "@/lib/utils";
import type { HostWallet, Payout } from "@bookmi/shared-types";

export default function WalletPage() {
  const walletQ = useHostWallet();
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  return (
    <div>
      <PageHeader title="Wallet" subtitle="Balance, recent activity, and payouts." />

      {walletQ.isPending ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : walletQ.isError || !walletQ.data ? (
        <div className="card p-6 flex items-start gap-3 border-red-200 bg-red-50">
          <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
          <div className="text-sm text-red-700">Couldn't load your wallet. Try refreshing.</div>
        </div>
      ) : (
        <WalletContent
          data={walletQ.data}
          onWithdraw={() => setWithdrawOpen(true)}
        />
      )}

      {withdrawOpen && walletQ.data && (
        <WithdrawModal
          wallet={walletQ.data.wallet}
          onClose={() => setWithdrawOpen(false)}
        />
      )}
    </div>
  );
}

function WalletContent({
  data,
  onWithdraw,
}: {
  data: WalletView;
  onWithdraw: () => void;
}) {
  const { wallet, recentBookings, recentPayouts } = data;

  const allTimeEarned = useMemo(
    () =>
      recentBookings
        .filter((b) => b.status === "confirmed" || b.status === "completed")
        .reduce((s, b) => s + b.netToHostKobo, 0),
    [recentBookings],
  );

  const inFlightPayouts = useMemo(() => {
    const inFlight: string[] = ["pending", "initiated"];
    return recentPayouts.filter((p) => inFlight.includes(p.status));
  }, [recentPayouts]);

  const pendingWithdrawals = useMemo(
    () => inFlightPayouts.reduce((s, p) => s + p.amountKobo, 0),
    [inFlightPayouts],
  );

  return (
    <>
      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <KpiCard
          icon={<WalletIcon className="w-5 h-5" />}
          label="Wallet balance"
          value={formatNaira(wallet.balanceKobo)}
          hint="Ready to withdraw"
          action={
            <button type="button" onClick={onWithdraw} className="btn-primary !py-2 !px-4 text-sm">
              Withdraw
            </button>
          }
        />
        <KpiCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="All-time earned"
          value={formatNaira(allTimeEarned)}
          hint="Net of platform fee, last 100 bookings."
        />
        <KpiCard
          icon={<Clock className="w-5 h-5" />}
          label="Pending withdrawals"
          value={formatNaira(pendingWithdrawals)}
          hint={`${inFlightPayouts.length} in flight`}
        />
      </div>

      {/* Reserved account */}
      {wallet.reservedAccountNumber && (
        <ReservedAccountCard
          accountNumber={wallet.reservedAccountNumber}
          bankName={wallet.reservedBankName ?? "Monnify"}
        />
      )}

      {/* Payout account */}
      <PayoutAccountCard wallet={wallet} />

      {/* Recent activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mt-6">
        <RecentBookingsCard bookings={recentBookings} />
        <RecentPayoutsCard payouts={recentPayouts} />
      </div>
    </>
  );
}

function KpiCard({
  icon,
  label,
  value,
  hint,
  action,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="card p-5 flex flex-col justify-between gap-3">
      <div>
        <div className="flex items-center gap-2 text-muted-foreground mb-2">
          {icon}
          <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
        </div>
        <div className="text-2xl font-bold tracking-tight">{value}</div>
        <div className="text-xs text-muted-foreground mt-1">{hint}</div>
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

function ReservedAccountCard({
  accountNumber,
  bankName,
}: {
  accountNumber: string;
  bankName: string;
}) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(accountNumber);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="card p-6 mb-6 bg-primary-light border-primary/20">
      <h2 className="text-lg font-semibold">Your reserved account</h2>
      <p className="text-sm text-muted-foreground mt-1">
        Transfer to this account to fund your Bookmi wallet — money lands within 60 seconds.
      </p>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-4">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Bank</div>
          <div className="font-mono text-lg font-semibold">{bankName}</div>
        </div>
        <div className="flex-1 min-w-[12rem]">
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Account number</div>
          <div className="font-mono text-lg font-semibold tracking-wider">{accountNumber}</div>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="btn-secondary inline-flex items-center gap-2"
        >
          {copied ? (
            <>
              <Check className="w-4 h-4" /> Copied
            </>
          ) : (
            <>
              <Copy className="w-4 h-4" /> Copy
            </>
          )}
        </button>
      </div>
    </div>
  );
}

function PayoutAccountCard({ wallet }: { wallet: HostWallet }) {
  const complete =
    wallet.bankAccountName && wallet.bankAccountNumber && wallet.bankCode;

  if (!complete) {
    return (
      <div className="card p-5 mb-6 flex items-start gap-3 border-red-200 bg-red-50">
        <AlertCircle className="w-5 h-5 text-red-700 shrink-0 mt-0.5" />
        <div className="flex-1">
          <div className="font-medium text-red-800">No payout account set</div>
          <p className="text-sm text-red-700 mt-1">
            Withdrawals need a bank account.{" "}
            <Link to="/dashboard/profile" className="underline font-medium">
              Set up in Profile → Payout details
            </Link>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="card p-5 mb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">Payout account</h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            Where withdrawals land.
          </p>
        </div>
        <Link
          to="/dashboard/profile"
          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
        >
          Edit <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-4 text-sm">
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Account name</div>
          <div className="font-medium mt-0.5">{wallet.bankAccountName}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Account number</div>
          <div className="font-mono font-medium mt-0.5">{wallet.bankAccountNumber}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Bank code</div>
          <div className="font-mono font-medium mt-0.5">{wallet.bankCode}</div>
        </div>
      </div>
    </div>
  );
}

function RecentBookingsCard({
  bookings,
}: {
  bookings: WalletView["recentBookings"];
}) {
  const items = bookings.slice(0, 6);
  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">Recent bookings</h2>
        <Link
          to="/dashboard/bookings"
          className="text-sm text-primary hover:underline inline-flex items-center gap-1"
        >
          See all <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground">No bookings yet.</div>
      ) : (
        <ul className="divide-y divide-gray-200">
          {items.map((b) => (
            <li key={b.id} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium truncate">{b.customerName}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {b.code ? `#${b.code} · ` : ""}
                  {b.slotStartAt
                    ? new Date(b.slotStartAt).toLocaleString()
                    : new Date(b.createdAt).toLocaleDateString()}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-medium">{formatNaira(b.netToHostKobo)}</div>
                <StatusPill status={b.status} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RecentPayoutsCard({ payouts }: { payouts: Payout[] }) {
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold mb-4">Recent payouts</h2>
      {payouts.length === 0 ? (
        <div className="text-sm text-muted-foreground">No withdrawals yet.</div>
      ) : (
        <ul className="divide-y divide-gray-200">
          {payouts.slice(0, 6).map((p) => (
            <li key={p.id} className="py-3 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="font-medium">{formatNaira(p.amountKobo)}</div>
                <div className="text-xs text-muted-foreground truncate">
                  {new Date(p.createdAt).toLocaleString()}
                </div>
              </div>
              <StatusPill status={p.status} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = status.replace(/_/g, " ");
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
  initiated: "bg-amber-50 text-amber-700",
  confirmed: "bg-primary-light text-primary",
  arrived: "bg-blue-50 text-blue-700",
  seated: "bg-blue-50 text-blue-700",
  completed: "bg-green-50 text-green-700",
  success: "bg-green-50 text-green-700",
  canceled: "bg-gray-100 text-gray-500",
  failed: "bg-red-50 text-red-700",
  no_show: "bg-gray-100 text-gray-500",
};

function WithdrawModal({
  wallet,
  onClose,
}: {
  wallet: HostWallet;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const balanceNaira = wallet.balanceKobo / 100;
  const hasPayoutAccount = !!wallet.bankAccountNumber;

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const parsed = Number(amount);
  const validAmount =
    amount.trim() !== "" &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed <= balanceNaira;

  const canSubmit = hasPayoutAccount && validAmount && !submitting;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!hasPayoutAccount) {
      setError("Add a payout account in Profile before withdrawing.");
      return;
    }
    if (!validAmount) {
      setError(
        parsed > balanceNaira
          ? "Amount exceeds your wallet balance."
          : "Enter an amount greater than 0.",
      );
      return;
    }
    setSubmitting(true);
    // Placeholder: no backend call. Endpoint lands with the payouts feature.
    window.setTimeout(() => {
      toast("Withdrawal endpoint lands with the payouts feature — coming soon.");
      setSubmitting(false);
      onClose();
    }, 250);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-md max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <form onSubmit={handleSubmit} className="p-6">
          <div className="flex items-start justify-between mb-1">
            <h2 className="text-xl font-semibold">Withdraw to bank</h2>
            <button
              type="button"
              onClick={onClose}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
          <p className="text-sm text-muted-foreground mb-6">
            Available balance: {formatNaira(wallet.balanceKobo)}
          </p>

          {!hasPayoutAccount && (
            <div className="mb-4 p-3 flex items-start gap-2 border border-red-200 bg-red-50">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <div className="text-sm text-red-700">
                No payout account set.{" "}
                <Link to="/dashboard/profile" className="underline font-medium">
                  Set up in Profile
                </Link>
                .
              </div>
            </div>
          )}

          <label className="block text-sm font-medium mb-2">Amount</label>
          <div className="flex items-stretch">
            <span className="inline-flex items-center px-3 border border-r-0 border-gray-200 bg-gray-50 text-sm text-muted-foreground select-none">
              ₦
            </span>
            <input
              className="input-field flex-1"
              type="number"
              min={0}
              step="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder="0"
              autoFocus
              disabled={!hasPayoutAccount}
            />
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">
            Up to {formatNaira(wallet.balanceKobo)}.
          </p>

          {error && (
            <div className="mt-4 p-3 flex items-start gap-2 border border-red-200 bg-red-50">
              <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
              <div className="text-sm text-red-700">{error}</div>
            </div>
          )}

          <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button type="submit" disabled={!canSubmit} className="btn-primary">
              {submitting && <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />}
              Request withdrawal
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
