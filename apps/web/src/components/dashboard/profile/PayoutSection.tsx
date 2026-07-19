import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Loader2, Wallet } from "lucide-react";
import { toast } from "sonner";
import { FormMessage } from "@/components/ui/FormMessage";
import { useDebounce } from "@/hooks/useDebounce";
import { useHostWallet } from "@/hooks/useHostWallet";
import {
  useBanks,
  useSavePayoutAccount,
  useVerifyBankAccount,
} from "@/hooks/useBanks";

/**
 * Self-contained payout-details form.
 *
 * Renders inside the Profile page's "Payout details" tab. Fetches the
 * current wallet + bank list, verifies (bankCode, accountNumber) via a
 * debounced provider call the moment both are filled, then lets the host
 * commit the verified triple to `host_wallets`.
 *
 * The account-name field is derived from the verification response — never
 * user-editable. The whole point is to store the correct triple so future
 * payouts land in the right hands.
 */
export function PayoutSection() {
  const walletQuery = useHostWallet();
  const banksQuery = useBanks();
  const verifyMutation = useVerifyBankAccount();
  const saveMutation = useSavePayoutAccount();

  const [bankCode, setBankCode] = useState<string>("");
  const [accountNumber, setAccountNumber] = useState<string>("");
  const [resolvedName, setResolvedName] = useState<string>("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const wallet = walletQuery.data?.wallet;
  const savedBankCode = wallet?.bankCode ?? "";
  const savedAccountNumber = wallet?.bankAccountNumber ?? "";
  const savedAccountName = wallet?.bankAccountName ?? "";

  // Prefill on first successful load — but only if the local form is still
  // untouched. Otherwise we'd stomp a half-filled edit whenever the wallet
  // query refetches.
  useEffect(() => {
    if (!wallet) return;
    setBankCode((prev) => prev || savedBankCode);
    setAccountNumber((prev) => prev || savedAccountNumber);
    setResolvedName((prev) => prev || savedAccountName);
    // Deliberately no dep on the state setters — this fires once per wallet
    // identity change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.hostId, savedBankCode, savedAccountNumber, savedAccountName]);

  const debouncedAccountNumber = useDebounce(accountNumber, 400);
  const debouncedBankCode = useDebounce(bankCode, 400);
  const isTenDigits = /^\d{10}$/.test(debouncedAccountNumber);
  const ready = !!debouncedBankCode && isTenDigits;

  // Snapshot the last (code, number) pair we've resolved, so a repeat verify
  // against the same inputs — e.g. after the wallet query refetches — is a
  // no-op instead of a wasteful provider round-trip.
  const [lastVerified, setLastVerified] = useState<{
    bankCode: string;
    accountNumber: string;
  } | null>(() =>
    savedBankCode && savedAccountNumber
      ? { bankCode: savedBankCode, accountNumber: savedAccountNumber }
      : null,
  );

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
    // verifyMutation is stable; adding it triggers re-run loops.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, debouncedBankCode, debouncedAccountNumber]);

  const banks = banksQuery.data ?? [];
  const selectedBank = useMemo(
    () => banks.find((b) => b.code === bankCode),
    [banks, bankCode],
  );

  const hasResolved = !!resolvedName;
  const differsFromSaved =
    bankCode !== savedBankCode ||
    accountNumber !== savedAccountNumber ||
    resolvedName !== savedAccountName;
  const canSave =
    hasResolved && differsFromSaved && !saveMutation.isPending && !verifyMutation.isPending;

  const handleSave = async () => {
    setSaveError(null);
    try {
      await saveMutation.mutateAsync({
        bankCode,
        accountNumber,
        accountName: resolvedName,
      });
      toast.success("Payout account saved");
    } catch (err) {
      setSaveError(readError(err));
    }
  };

  const walletLoading = walletQuery.isLoading;
  const isVerifying = verifyMutation.isPending;
  // Show the "Verified" pill only when the current form matches what's saved
  // AND the saved row has a resolved name — i.e. nothing pending.
  const showVerifiedBadge =
    !!savedAccountName &&
    savedBankCode === bankCode &&
    savedAccountNumber === accountNumber &&
    resolvedName === savedAccountName;

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Payout details</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Where withdrawals land.</p>
        </div>
        {showVerifiedBadge && (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-800 bg-green-100">
            <Check className="w-3 h-3" />
            Verified
          </span>
        )}
      </div>

      {walletLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-4">
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
                // Numeric-only filter — mirrors the digits the input mode
                // hints for on mobile, but enforces it on desktop too.
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

          {saveError && <FormMessage variant="error" message={saveError} />}

          <div className="flex justify-end pt-2">
            <button
              type="button"
              disabled={!canSave}
              onClick={handleSave}
              className="btn-primary"
            >
              {saveMutation.isPending ? "Saving…" : "Save payout account"}
            </button>
          </div>
        </div>
      )}
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
