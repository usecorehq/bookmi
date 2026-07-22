/**
 * Wire type for a single wallet_ledger row. Mirrors the drizzle model on
 * the API side. `current_hash` + `prev_hash` are exposed so a client-side
 * verifier could re-walk the chain if we ever want that feature; the UI
 * ignores them today.
 */

export type LedgerEntryType = "credit" | "debit";
export type LedgerSourceType =
  | "payment_transaction"
  | "payout"
  | "refund"
  | "reserved_account"
  | "paycode";
export type LedgerSourceMode =
  | "booking"
  | "tip"
  | "withdrawal"
  | "refund"
  | "wallet_topup"
  | "paycode_redemption";
export type LedgerEntryStatus = "pending" | "success" | "failed" | "cancelled";

export interface WalletLedgerEntry {
  id: string;
  hostId: string;
  amountKobo: number;
  type: LedgerEntryType;
  sourceId: string | null;
  sourceType: LedgerSourceType;
  sourceMode: LedgerSourceMode;
  balanceBeforeKobo: number;
  balanceAfterKobo: number;
  status: LedgerEntryStatus;
  memo: string | null;
  currentHash: string;
  prevHash: string | null;
  createdAt: string;
  updatedAt: string;
}

/** One day's roll-up for the dashboard bar chart. Kobo. */
export interface DailyGrossBucket {
  date: string;
  bookingKobo: number;
  tipKobo: number;
}
