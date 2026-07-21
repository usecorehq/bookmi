import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  Wallet as WalletIcon,
  TrendingUp,
  Clock,
  Copy,
  Check,
  ArrowUpRight,
  ArrowLeft,
  AlertCircle,
  Loader2,
  Landmark,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { useHostWallet, type WalletView } from "@/hooks/useHostWallet";
import { useBanks } from "@/hooks/useBanks";
import { useRequestOtp } from "@/hooks/useSecurityOtp";
import { useWithdraw } from "@/hooks/useWithdraw";
import { useActivateReservedAccount } from "@/hooks/useActivateReservedAccount";
import { FormMessage } from "@/components/ui/FormMessage";
import { formatNaira } from "@/lib/utils";
import type { HostWallet, Payout } from "@bookmi/shared-types";

export default function WalletPage() {
  const walletQ = useHostWallet();
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const [activateOpen, setActivateOpen] = useState(false);

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
          onActivateReservedAccount={() => setActivateOpen(true)}
        />
      )}

      {withdrawOpen && walletQ.data && (
        <WithdrawModal
          wallet={walletQ.data.wallet}
          onClose={() => setWithdrawOpen(false)}
        />
      )}

      {activateOpen && (
        <ActivateReservedAccountModal onClose={() => setActivateOpen(false)} />
      )}
    </div>
  );
}

function WalletContent({
  data,
  onWithdraw,
  onActivateReservedAccount,
}: {
  data: WalletView;
  onWithdraw: () => void;
  onActivateReservedAccount: () => void;
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
      {wallet.reservedAccountNumber ? (
        <ReservedAccountCard
          accountNumber={wallet.reservedAccountNumber}
          bankName={wallet.reservedBankName ?? "Monnify"}
        />
      ) : (
        <PendingActivationCard onActivate={onActivateReservedAccount} />
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

function PendingActivationCard({ onActivate }: { onActivate: () => void }) {
  return (
    <div className="card p-6 mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="flex items-start gap-3 min-w-0">
        <div className="p-2 bg-primary-light text-primary shrink-0">
          <Landmark className="w-5 h-5" />
        </div>
        <div>
          <h2 className="text-lg font-semibold">Get a reserved account</h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-md">
            Get a dedicated bank account number — customers can transfer directly to fund your
            wallet, no popup needed.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onActivate}
        className="btn-primary shrink-0"
      >
        Activate
      </button>
    </div>
  );
}

function PayoutAccountCard({ wallet }: { wallet: HostWallet }) {
  const { data: banks } = useBanks();
  const bankName = useMemo(
    () => banks?.find((b) => b.code === wallet.bankCode)?.name ?? null,
    [banks, wallet.bankCode],
  );
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
            <Link to="/dashboard/profile?tab=payout" className="underline font-medium">
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
          to="/dashboard/profile?tab=payout"
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
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Bank</div>
          <div className="font-medium mt-0.5">
            {bankName ?? <span className="font-mono">{wallet.bankCode}</span>}
          </div>
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
        <h2 className="text-lg font-semibold">Recent inflows</h2>
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

/**
 * Two-step withdraw flow — mirrors the refund modal so the OTP experience
 * feels the same everywhere money leaves the wallet.
 *
 * Step 1: amount + read-only preview of the saved payout account.
 * Step 2: OTP challenge, resend link, "Change amount" back link.
 */
function WithdrawModal({
  wallet,
  onClose,
}: {
  wallet: HostWallet;
  onClose: () => void;
}) {
  const requestOtpMutation = useRequestOtp();
  const withdrawMutation = useWithdraw();
  const { data: banks } = useBanks();
  const bankName = useMemo(
    () => banks?.find((b) => b.code === wallet.bankCode)?.name ?? null,
    [banks, wallet.bankCode],
  );

  // One idempotency key per attempt — a retry with the same key hits the
  // cached ledger row instead of a second disbursement. Regenerated when the
  // host goes back to "Change amount" after a failed confirm (see below), so
  // a corrected resubmission can't collide with the stale key a prior failed
  // attempt already claimed.
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    crypto.randomUUID(),
  );

  const [step, setStep] = useState<"amount" | "otp">("amount");
  const [amount, setAmount] = useState("");
  const [amountError, setAmountError] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpExpiresAt, setOtpExpiresAt] = useState<Date | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const otpInputRef = useRef<HTMLInputElement>(null);

  const balanceNaira = wallet.balanceKobo / 100;
  const hasPayoutAccount = !!wallet.bankAccountNumber && !!wallet.bankCode;

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  useEffect(() => {
    if (step !== "otp") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step]);

  useEffect(() => {
    if (step === "otp") otpInputRef.current?.focus();
  }, [step]);

  const parsed = Number(amount);
  const validAmount =
    amount.trim() !== "" &&
    Number.isFinite(parsed) &&
    parsed > 0 &&
    parsed <= balanceNaira;
  const amountKobo = validAmount ? Math.round(parsed * 100) : 0;

  const handleContinue = async () => {
    setAmountError(null);
    if (!hasPayoutAccount) {
      setAmountError("Add a payout account in Profile before withdrawing.");
      return;
    }
    if (!validAmount) {
      setAmountError(
        parsed > balanceNaira
          ? "Amount exceeds your wallet balance."
          : "Enter an amount greater than 0.",
      );
      return;
    }
    try {
      const res = await requestOtpMutation.mutateAsync("withdraw_funds");
      setOtpExpiresAt(new Date(res.expiresAt));
      setOtpCode("");
      setOtpError(null);
      setStep("otp");
    } catch (err) {
      setAmountError(readError(err));
    }
  };

  const handleResend = async () => {
    setOtpError(null);
    try {
      const res = await requestOtpMutation.mutateAsync("withdraw_funds");
      setOtpExpiresAt(new Date(res.expiresAt));
      setOtpCode("");
      toast.success("New code sent.");
    } catch (err) {
      toast.error(readError(err));
    }
  };

  const handleConfirm = async () => {
    setOtpError(null);
    if (!/^\d{6}$/.test(otpCode)) {
      setOtpError("Enter the 6-digit code.");
      return;
    }
    try {
      await withdrawMutation.mutateAsync({
        amountKobo,
        idempotencyKey,
        otpCode,
      });
      toast.success("Withdrawal initiated");
      onClose();
    } catch (err) {
      setOtpError(readError(err));
    }
  };

  const remainingMs = otpExpiresAt ? otpExpiresAt.getTime() - now : 0;
  const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = Math.floor(remainingSec / 60);
  const ss = String(remainingSec % 60).padStart(2, "0");

  const acctLast4 = wallet.bankAccountNumber?.slice(-4) ?? "----";

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
        <div className="p-6 border-b border-gray-200 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">Withdraw to bank</h2>
            <p className="text-sm text-muted-foreground mt-1">
              {step === "amount"
                ? `Available: ${formatNaira(wallet.balanceKobo)}`
                : "Confirm the withdrawal with the code we just emailed you."}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {step === "amount" ? (
          <>
            <div className="p-6 space-y-4">
              {!hasPayoutAccount && (
                <div className="p-3 flex items-start gap-2 border border-red-200 bg-red-50">
                  <AlertCircle className="w-4 h-4 text-red-700 shrink-0 mt-0.5" />
                  <div className="text-sm text-red-700">
                    No payout account set.{" "}
                    <Link
                      to="/dashboard/profile?tab=payout"
                      className="underline font-medium"
                    >
                      Set up in Profile
                    </Link>
                    .
                  </div>
                </div>
              )}

              <div>
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
                    onChange={(e) => {
                      setAmount(e.target.value);
                      setAmountError(null);
                    }}
                    placeholder={formatNaira(wallet.balanceKobo).replace("₦", "")}
                    autoFocus
                    disabled={!hasPayoutAccount}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Up to {formatNaira(wallet.balanceKobo)}.
                </p>
              </div>

              {hasPayoutAccount && (
                <div className="border border-gray-200 bg-gray-50 p-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground uppercase tracking-wide">
                        Payout account
                      </div>
                      <div className="text-sm font-medium mt-0.5 truncate">
                        {wallet.bankAccountName}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {bankName ?? wallet.bankCode} ·{" "}
                        <span className="font-mono">••••{acctLast4}</span>
                      </div>
                    </div>
                    <Link
                      to="/dashboard/profile?tab=payout"
                      className="text-xs text-primary hover:underline shrink-0"
                    >
                      Change in Profile
                    </Link>
                  </div>
                </div>
              )}

              {amountError && (
                <FormMessage variant="error" message={amountError} />
              )}
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
              <button
                type="button"
                onClick={onClose}
                disabled={requestOtpMutation.isPending}
                className="btn-secondary"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleContinue}
                disabled={
                  !hasPayoutAccount ||
                  !validAmount ||
                  requestOtpMutation.isPending
                }
                className="btn-primary"
              >
                {requestOtpMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />
                )}
                Continue
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="p-6 space-y-4">
              <div>
                <h3 className="text-base font-semibold">
                  Enter the 6-digit code we just emailed you
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Expires in {mm}:{ss}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">
                  Verification code
                </label>
                <input
                  ref={otpInputRef}
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  className="input-field text-center text-lg tracking-[0.5em] font-mono"
                  value={otpCode}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                    setOtpCode(digits);
                    setOtpError(null);
                  }}
                  placeholder="000000"
                />
              </div>

              <div className="text-sm">
                <button
                  type="button"
                  onClick={handleResend}
                  disabled={requestOtpMutation.isPending}
                  className="text-primary hover:underline disabled:opacity-50"
                >
                  Didn't get it? Resend
                </button>
              </div>

              {otpError && <FormMessage variant="error" message={otpError} />}

              <div className="text-xs text-muted-foreground border-t border-gray-200 pt-4 mt-4">
                <div className="font-medium mb-1">Withdrawal summary</div>
                <div>
                  {formatNaira(amountKobo)} → {wallet.bankAccountName} · ••••
                  {acctLast4}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep("amount");
                  setOtpError(null);
                  // Fresh key — see the comment where idempotencyKey is
                  // declared. Otherwise a corrected resubmission (e.g. a
                  // lower amount after an insufficient-balance failure)
                  // collides with the previous attempt's claimed key and
                  // surfaces its stale failure reason instead of actually
                  // retrying.
                  setIdempotencyKey(crypto.randomUUID());
                }}
                disabled={withdrawMutation.isPending}
                className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Change amount
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={
                  withdrawMutation.isPending || !/^\d{6}$/.test(otpCode)
                }
                className="btn-primary"
              >
                {withdrawMutation.isPending && (
                  <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />
                )}
                Confirm withdrawal {formatNaira(amountKobo)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/**
 * Simple one-field modal that collects the host's BVN and activates a
 * (mocked) reserved bank account. Mirrors WithdrawModal's structure —
 * overlay + card, Escape-to-close, FormMessage for errors.
 */
function ActivateReservedAccountModal({ onClose }: { onClose: () => void }) {
  const activateMutation = useActivateReservedAccount();
  const [bvn, setBvn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const isValidBvn = /^\d{11}$/.test(bvn);

  const handleSubmit = async () => {
    setError(null);
    if (!isValidBvn) {
      setError("Enter your 11-digit BVN.");
      return;
    }
    try {
      await activateMutation.mutateAsync({ bvn });
      toast.success("Reserved account activated");
      onClose();
    } catch (err) {
      setError(readError(err));
    }
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
        <div className="p-6 border-b border-gray-200 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold">Activate reserved account</h2>
            <p className="text-sm text-muted-foreground mt-1">
              We need your BVN to set up a dedicated account number for direct transfers.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">BVN</label>
            <input
              ref={inputRef}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className="input-field font-mono tracking-wider"
              value={bvn}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 11);
                setBvn(digits);
                setError(null);
              }}
              placeholder="12345678901"
              maxLength={11}
              disabled={activateMutation.isPending}
            />
            <p className="text-xs text-muted-foreground mt-1.5">
              11 digits. Used only to set up your reserved account for this demo.
            </p>
          </div>

          {error && <FormMessage variant="error" message={error} />}
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={activateMutation.isPending}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isValidBvn || activateMutation.isPending}
            className="btn-primary"
          >
            {activateMutation.isPending && (
              <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />
            )}
            Activate
          </button>
        </div>
      </div>
    </div>
  );
}

function readError(err: unknown): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: unknown }).body;
    if (body && typeof body === "object" && "message" in body) {
      const m = (body as { message?: unknown }).message;
      if (typeof m === "string") return m;
      if (Array.isArray(m)) return m.join(", ");
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
