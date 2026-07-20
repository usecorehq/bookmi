import { useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Loader2, Pencil, Wallet } from "lucide-react";
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
 * Self-contained payout-details form with two modes:
 *
 *   - **view**: default when the wallet already has a saved payout account.
 *     Renders the saved bank + account + name as read-only rows with a
 *     Verified pill; no verify API call fires.
 *   - **edit**: entered by clicking "Edit" (or by default when nothing is
 *     saved yet). Reveals the bank dropdown + account number input; the
 *     400ms-debounced verify effect only runs in this mode so the name
 *     resolver isn't hammered on every tab visit.
 *
 * The account-name is never user-editable — it's derived from the
 * verification response.
 */
export function PayoutSection() {
  const walletQuery = useHostWallet();
  const banksQuery = useBanks();
  const verifyMutation = useVerifyBankAccount();
  const saveMutation = useSavePayoutAccount();

  const wallet = walletQuery.data?.wallet;
  const savedBankCode = wallet?.bankCode ?? "";
  const savedAccountNumber = wallet?.bankAccountNumber ?? "";
  const savedAccountName = wallet?.bankAccountName ?? "";
  const hasSavedPayout = !!(savedBankCode && savedAccountNumber && savedAccountName);

  const [editing, setEditing] = useState<boolean>(false);
  const [bankCode, setBankCode] = useState<string>("");
  const [accountNumber, setAccountNumber] = useState<string>("");
  const [resolvedName, setResolvedName] = useState<string>("");
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [lastVerified, setLastVerified] = useState<{
    bankCode: string;
    accountNumber: string;
  } | null>(null);

  // On first wallet load, decide the initial mode. If nothing's saved,
  // drop straight into edit so the host can enter details without a click.
  useEffect(() => {
    if (!wallet) return;
    if (!hasSavedPayout) {
      setEditing(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wallet?.hostId]);

  const debouncedAccountNumber = useDebounce(accountNumber, 400);
  const debouncedBankCode = useDebounce(bankCode, 400);
  const isTenDigits = /^\d{10}$/.test(debouncedAccountNumber);
  const ready = editing && !!debouncedBankCode && isTenDigits;

  // Auto-verify ONLY while editing. `lastVerified` guards against redundant
  // provider calls when the same (code, number) tuple is entered again.
  useEffect(() => {
    if (!ready) {
      if (editing) {
        setResolvedName("");
        setVerifyError(null);
      }
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
  }, [ready, editing, debouncedBankCode, debouncedAccountNumber]);

  const banks = banksQuery.data ?? [];
  const selectedBank = useMemo(
    () => banks.find((b) => b.code === bankCode),
    [banks, bankCode],
  );
  const savedBank = useMemo(
    () => banks.find((b) => b.code === savedBankCode),
    [banks, savedBankCode],
  );

  const hasResolved = !!resolvedName;
  const differsFromSaved =
    bankCode !== savedBankCode ||
    accountNumber !== savedAccountNumber ||
    resolvedName !== savedAccountName;
  const canSave =
    editing &&
    hasResolved &&
    differsFromSaved &&
    !saveMutation.isPending &&
    !verifyMutation.isPending;

  const startEditing = () => {
    setEditing(true);
    setSaveError(null);
    // Prefill from saved so the host can tweak one field without retyping;
    // seed `lastVerified` so the effect doesn't re-hit the provider for
    // the exact tuple that was already resolved on the server.
    setBankCode(savedBankCode);
    setAccountNumber(savedAccountNumber);
    setResolvedName(savedAccountName);
    setVerifyError(null);
    setLastVerified(
      savedBankCode && savedAccountNumber
        ? { bankCode: savedBankCode, accountNumber: savedAccountNumber }
        : null,
    );
  };

  const cancelEditing = () => {
    setEditing(false);
    setBankCode("");
    setAccountNumber("");
    setResolvedName("");
    setVerifyError(null);
    setSaveError(null);
  };

  const handleSave = async () => {
    setSaveError(null);
    try {
      await saveMutation.mutateAsync({
        bankCode,
        accountNumber,
        accountName: resolvedName,
      });
      toast.success("Payout account saved");
      setEditing(false);
      // Reset local scratch state — the view state re-reads from wallet on next render.
      setBankCode("");
      setAccountNumber("");
      setResolvedName("");
      setLastVerified(null);
    } catch (err) {
      setSaveError(readError(err));
    }
  };

  const isVerifying = verifyMutation.isPending;

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Payout details</h2>
          <p className="text-sm text-muted-foreground mt-0.5">Where withdrawals land.</p>
        </div>
        {hasSavedPayout && !editing && (
          <span className="inline-flex items-center gap-1 px-2 py-1 text-xs font-medium text-green-800 bg-green-100">
            <Check className="w-3 h-3" />
            Verified
          </span>
        )}
      </div>

      {walletQuery.isLoading ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : !editing && hasSavedPayout ? (
        <ViewState
          bankName={savedBank?.name ?? "Bank"}
          accountNumber={savedAccountNumber}
          accountName={savedAccountName}
          onEdit={startEditing}
        />
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

          <div className="flex justify-end items-center gap-2 pt-2">
            {hasSavedPayout && (
              <button
                type="button"
                onClick={cancelEditing}
                disabled={saveMutation.isPending}
                className="btn-secondary"
              >
                Cancel
              </button>
            )}
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

function ViewState({
  bankName,
  accountNumber,
  accountName,
  onEdit,
}: {
  bankName: string;
  accountNumber: string;
  accountName: string;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-4">
      <ReadonlyRow label="Bank" value={bankName} />
      <ReadonlyRow label="Account number" value={accountNumber} mono />
      <ReadonlyRow label="Account name" value={accountName} />
      <div className="flex justify-end pt-2">
        <button
          type="button"
          onClick={onEdit}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <Pencil className="w-3.5 h-3.5" />
          Edit
        </button>
      </div>
    </div>
  );
}

function ReadonlyRow({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground mb-1">
        {label}
      </div>
      <div
        className={`px-3 py-2.5 bg-gray-50 border border-gray-200 text-sm ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
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
