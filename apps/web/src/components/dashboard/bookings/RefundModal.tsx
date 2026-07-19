import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import type { Booking } from "@bookmi/shared-types";
import { FormMessage } from "@/components/ui/FormMessage";
import { useDebounce } from "@/hooks/useDebounce";
import { useBanks, useVerifyBankAccount } from "@/hooks/useBanks";
import { useRefundBooking } from "@/hooks/useBookingActions";
import { formatNaira } from "@/lib/utils";

/**
 * Refund popup shown when the host clicks "Refund" in the booking-detail
 * drawer. Reuses the payout-form's debounced auto-verify pattern so the
 * host confirms the destination account before hitting Submit — the server
 * re-verifies on write, so nothing enters the disbursement API without a
 * matched name.
 *
 * Fields:
 *   - Amount (kobo, ₦-prefixed, defaults to full paid amount, editable within
 *     the refundable balance)
 *   - Bank dropdown + 10-digit account number → auto name-enquiry
 *   - Optional reason (audit trail on the booking row)
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

  // Refundable balance = paid amount minus any prior partial refunds.
  const alreadyRefunded = booking.refundedAmountKobo ?? 0;
  const maxRefundableKobo = Math.max(0, booking.amountKobo - alreadyRefunded);

  // Amount is edited as a naira string so the user can see "1,500" rather
  // than 150000. Converted back to kobo on submit.
  const [amountNaira, setAmountNaira] = useState<string>(() =>
    (maxRefundableKobo / 100).toString(),
  );
  const [bankCode, setBankCode] = useState<string>("");
  const [accountNumber, setAccountNumber] = useState<string>("");
  const [resolvedName, setResolvedName] = useState<string>("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [reason, setReason] = useState<string>("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [lastVerified, setLastVerified] = useState<{
    bankCode: string;
    accountNumber: string;
  } | null>(null);

  // Close on ESC — matches how BookingDetailModal handles the key.
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

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

  // Parse the naira input to a kobo integer. Empty / non-numeric → 0.
  const amountKobo = useMemo(() => {
    const cleaned = amountNaira.replace(/,/g, "").trim();
    if (!cleaned) return 0;
    const asFloat = parseFloat(cleaned);
    if (!Number.isFinite(asFloat) || asFloat <= 0) return 0;
    return Math.round(asFloat * 100);
  }, [amountNaira]);

  const amountValid = amountKobo > 0 && amountKobo <= maxRefundableKobo;
  const canSubmit =
    amountValid && !!resolvedName && !refundMutation.isPending && !verifyMutation.isPending;

  const handleSubmit = async () => {
    setSubmitError(null);
    if (!canSubmit) return;
    try {
      await refundMutation.mutateAsync({
        bookingId: booking.id,
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
      setSubmitError(readError(err));
    }
  };

  const isVerifying = verifyMutation.isPending;

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
            Transfer money back to the customer's bank account. The refund
            debits your wallet balance.
          </p>
        </div>

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
                  // Allow digits + one decimal point.
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

          {submitError && <FormMessage variant="error" message={submitError} />}
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={refundMutation.isPending}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!canSubmit}
            className="btn-primary !bg-red-600 hover:!bg-red-700"
          >
            {refundMutation.isPending && (
              <Loader2 className="w-4 h-4 animate-spin" />
            )}
            {amountValid
              ? `Refund ${formatNaira(amountKobo)}`
              : "Refund"}
          </button>
        </div>
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
