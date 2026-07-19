import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowLeft, Check, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import type { Booking } from "@bookmi/shared-types";
import { FormMessage } from "@/components/ui/FormMessage";
import { useDebounce } from "@/hooks/useDebounce";
import { useBanks, useVerifyBankAccount } from "@/hooks/useBanks";
import { useRefundBooking } from "@/hooks/useBookingActions";
import { useRequestOtp } from "@/hooks/useSecurityOtp";
import { formatNaira } from "@/lib/utils";

/**
 * Two-step refund flow.
 *
 * Step 1 — Details: amount, destination bank, account number (auto
 *   name-enquiry), optional reason. Continue mints an idempotency key and
 *   requests a fresh OTP from the API. OTP is emailed to the host.
 *
 * Step 2 — OTP challenge: 6-digit input, countdown timer, resend link.
 *   Confirm calls the refund endpoint with the OTP + idempotency key in
 *   headers. The key is stable across resends and step-back — so if the
 *   host retries with the same details later, the ledger row still binds
 *   and no double disbursement can occur.
 */
export function RefundModal({
  booking,
  onClose,
}: {
  booking: Booking;
  onClose: () => void;
}) {
  const banksQuery = useBanks();
  const verifyMutation = useVerifyBankAccount();
  const refundMutation = useRefundBooking();
  const requestOtpMutation = useRequestOtp();

  // One idempotency key per modal open. Stable across step navigation +
  // OTP resends — the server ledger dedupes on it.
  const idempotencyKey = useMemo(() => crypto.randomUUID(), []);

  // Refundable balance = paid amount minus any prior partial refunds.
  const alreadyRefunded = booking.refundedAmountKobo ?? 0;
  const maxRefundableKobo = Math.max(0, booking.amountKobo - alreadyRefunded);

  const [step, setStep] = useState<"details" | "otp">("details");

  // ─── Step 1 state ────────────────────────────────────────────────
  const [amountNaira, setAmountNaira] = useState<string>(() =>
    (maxRefundableKobo / 100).toString(),
  );
  const [bankCode, setBankCode] = useState<string>("");
  const [accountNumber, setAccountNumber] = useState<string>("");
  const [resolvedName, setResolvedName] = useState<string>("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [reason, setReason] = useState<string>("");
  const [detailsError, setDetailsError] = useState<string | null>(null);
  const [lastVerified, setLastVerified] = useState<{
    bankCode: string;
    accountNumber: string;
  } | null>(null);

  // ─── Step 2 state ────────────────────────────────────────────────
  const [otpCode, setOtpCode] = useState<string>("");
  const [otpExpiresAt, setOtpExpiresAt] = useState<Date | null>(null);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const otpInputRef = useRef<HTMLInputElement>(null);

  // Close on ESC — matches BookingDetailModal.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  // Countdown tick — 1s cadence keeps the "min:sec" copy live.
  useEffect(() => {
    if (step !== "otp") return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [step]);

  // Focus the code input when we land on step 2.
  useEffect(() => {
    if (step === "otp") otpInputRef.current?.focus();
  }, [step]);

  const debouncedAccountNumber = useDebounce(accountNumber, 400);
  const debouncedBankCode = useDebounce(bankCode, 400);
  const isTenDigits = /^\d{10}$/.test(debouncedAccountNumber);
  const ready = !!debouncedBankCode && isTenDigits;

  // Auto-verify — same shape as PayoutSection so the two forms feel identical.
  useEffect(() => {
    if (!ready) {
      setResolvedName("");
      setVerifyError(null);
      return;
    }
    if (
      lastVerified &&
      lastVerified.bankCode === debouncedBankCode &&
      lastVerified.accountNumber === debouncedAccountNumber &&
      resolvedName
    ) {
      return;
    }

    let cancelled = false;
    setVerifyError(null);
    verifyMutation
      .mutateAsync({
        bankCode: debouncedBankCode,
        accountNumber: debouncedAccountNumber,
      })
      .then((r) => {
        if (cancelled) return;
        setResolvedName(r.accountName);
        setLastVerified({
          bankCode: debouncedBankCode,
          accountNumber: debouncedAccountNumber,
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setResolvedName("");
        setVerifyError(readError(err));
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, debouncedBankCode, debouncedAccountNumber]);

  const banks = banksQuery.data ?? [];
  const selectedBank = useMemo(
    () => banks.find((b) => b.code === bankCode),
    [banks, bankCode],
  );

  const amountKobo = useMemo(() => {
    const cleaned = amountNaira.replace(/,/g, "").trim();
    if (!cleaned) return 0;
    const asFloat = parseFloat(cleaned);
    if (!Number.isFinite(asFloat) || asFloat <= 0) return 0;
    return Math.round(asFloat * 100);
  }, [amountNaira]);

  const amountValid = amountKobo > 0 && amountKobo <= maxRefundableKobo;
  const detailsReady =
    amountValid && !!resolvedName && !verifyMutation.isPending;

  const isVerifying = verifyMutation.isPending;

  // ─── Step 1 → Step 2 ────────────────────────────────────────────
  const handleContinue = async () => {
    setDetailsError(null);
    if (!detailsReady) return;
    try {
      const res = await requestOtpMutation.mutateAsync("refund_booking");
      setOtpExpiresAt(new Date(res.expiresAt));
      setOtpCode("");
      setOtpError(null);
      setStep("otp");
    } catch (err) {
      setDetailsError(readError(err));
    }
  };

  const handleResend = async () => {
    setOtpError(null);
    try {
      const res = await requestOtpMutation.mutateAsync("refund_booking");
      setOtpExpiresAt(new Date(res.expiresAt));
      setOtpCode("");
      toast.success("New code sent.");
    } catch (err) {
      toast.error(readError(err));
    }
  };

  // ─── Confirm refund ──────────────────────────────────────────────
  const handleConfirm = async () => {
    setOtpError(null);
    if (!/^\d{6}$/.test(otpCode)) {
      setOtpError("Enter the 6-digit code.");
      return;
    }
    try {
      await refundMutation.mutateAsync({
        bookingId: booking.id,
        idempotencyKey,
        otpCode,
        input: {
          bankCode,
          accountNumber,
          accountName: resolvedName,
          amountKobo,
          reason: reason.trim() || undefined,
        },
      });
      toast.success("Refund initiated");
      onClose();
    } catch (err) {
      setOtpError(readError(err));
    }
  };

  const remainingMs = otpExpiresAt ? otpExpiresAt.getTime() - now : 0;
  const remainingSec = Math.max(0, Math.floor(remainingMs / 1000));
  const mm = Math.floor(remainingSec / 60);
  const ss = String(remainingSec % 60).padStart(2, "0");

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-[500px] max-h-[90vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Refund booking"
      >
        <div className="p-6 border-b border-gray-200">
          <h2 className="text-lg font-semibold">
            Refund #{booking.code ?? booking.id.slice(0, 8)}
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            {step === "details"
              ? "Transfer money back to the customer's bank account. The refund debits your wallet balance."
              : "Confirm the refund with the code we just emailed you."}
          </p>
        </div>

        {step === "details" ? (
          <>
            <div className="p-6 space-y-4">
              <Field
                label="Amount"
                hint={`Refundable: ${formatNaira(maxRefundableKobo)}`}
              >
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none">
                    &#8358;
                  </span>
                  <input
                    type="text"
                    inputMode="decimal"
                    autoComplete="off"
                    className="input-field pl-7"
                    value={amountNaira}
                    onChange={(e) => {
                      const cleaned = e.target.value.replace(/[^\d.]/g, "");
                      const parts = cleaned.split(".");
                      const normalized =
                        parts.length > 1
                          ? `${parts[0] ?? ""}.${parts.slice(1).join("").slice(0, 2)}`
                          : (parts[0] ?? "");
                      setAmountNaira(normalized);
                    }}
                    placeholder="0.00"
                  />
                </div>
                {!amountValid && amountNaira && (
                  <p className="text-xs text-red-700 mt-1.5 inline-flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3" />
                    {amountKobo <= 0
                      ? "Enter an amount greater than zero."
                      : `Max refundable is ${formatNaira(maxRefundableKobo)}.`}
                  </p>
                )}
              </Field>

              <Field label="Bank">
                <select
                  className="input-field"
                  value={bankCode}
                  onChange={(e) => {
                    setBankCode(e.target.value);
                    setResolvedName("");
                    setVerifyError(null);
                  }}
                  disabled={banksQuery.isLoading || banksQuery.isError}
                >
                  <option value="">
                    {banksQuery.isLoading ? "Loading banks…" : "Select bank"}
                  </option>
                  {banks.map((b) => (
                    <option key={b.code} value={b.code}>
                      {b.name}
                    </option>
                  ))}
                </select>
                {banksQuery.isError && (
                  <p className="text-xs text-red-700 mt-1.5 inline-flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3" />
                    Couldn't load banks — try again shortly.
                  </p>
                )}
              </Field>

              <Field label="Account number" hint="10 digits — no spaces.">
                <input
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  className="input-field"
                  value={accountNumber}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, "").slice(0, 10);
                    setAccountNumber(digits);
                    setResolvedName("");
                    setVerifyError(null);
                  }}
                  placeholder="0123456789"
                  maxLength={10}
                />
                {isVerifying && ready && (
                  <p className="text-xs text-muted-foreground mt-1.5 inline-flex items-center gap-1.5">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    Verifying…
                  </p>
                )}
                {verifyError && !isVerifying && (
                  <p className="text-xs text-red-700 mt-1.5 inline-flex items-center gap-1.5">
                    <AlertCircle className="w-3 h-3" />
                    {verifyError}
                  </p>
                )}
              </Field>

              <Field
                label="Account name"
                hint="Auto-filled from the bank once we verify the number."
              >
                <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 border border-gray-200 text-sm">
                  {resolvedName ? (
                    <>
                      <Check className="w-4 h-4 text-green-700 shrink-0" />
                      <span className="font-medium">{resolvedName}</span>
                    </>
                  ) : (
                    <>
                      <Wallet className="w-4 h-4 text-muted-foreground shrink-0" />
                      <span className="text-muted-foreground">
                        {ready && isVerifying
                          ? "Verifying…"
                          : "Pick a bank and enter the account number."}
                      </span>
                    </>
                  )}
                </div>
                {selectedBank && resolvedName && (
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {selectedBank.name} · {accountNumber}
                  </p>
                )}
              </Field>

              <Field label="Reason (optional)">
                <textarea
                  className="input-field min-h-[80px] resize-y"
                  value={reason}
                  onChange={(e) => setReason(e.target.value.slice(0, 500))}
                  placeholder="Recorded on the booking — not sent to the customer."
                  maxLength={500}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  {reason.length}/500
                </p>
              </Field>

              {detailsError && (
                <FormMessage variant="error" message={detailsError} />
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
                disabled={!detailsReady || requestOtpMutation.isPending}
                className="btn-primary"
              >
                {requestOtpMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
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
                <div className="font-medium mb-1">Refund summary</div>
                <div>
                  {formatNaira(amountKobo)} → {resolvedName} ·{" "}
                  {selectedBank?.name ?? bankCode} · {accountNumber}
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setStep("details");
                  setOtpError(null);
                }}
                disabled={refundMutation.isPending}
                className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <ArrowLeft className="w-3.5 h-3.5" /> Change details
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={
                  refundMutation.isPending || !/^\d{6}$/.test(otpCode)
                }
                className="btn-primary !bg-red-600 hover:!bg-red-700"
              >
                {refundMutation.isPending && (
                  <Loader2 className="w-4 h-4 animate-spin" />
                )}
                Confirm refund {formatNaira(amountKobo)}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1.5">{hint}</p>}
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
