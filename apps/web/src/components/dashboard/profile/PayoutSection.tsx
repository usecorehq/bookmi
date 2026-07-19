/**
 * Stub — Agent B (bank verification) fills this in parallel with:
 *   - Bank dropdown (from GET /hosts/me/wallet/banks)
 *   - Account number input
 *   - Auto-resolved account name (POST /hosts/me/wallet/verify-bank-account)
 *   - Save via POST /hosts/me/wallet/payout-account (server re-verifies)
 *
 * Self-contained: owns its own state, does its own API calls. Parent just
 * mounts it in the Payout Details tab — no shared FormState.
 */
export function PayoutSection() {
  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold mb-1">Payout details</h2>
      <p className="text-sm text-muted-foreground">
        Where withdrawals land — bank verification landing shortly.
      </p>
    </div>
  );
}
