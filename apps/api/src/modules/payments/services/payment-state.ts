import type { PaymentStatus } from "../../../drizzle/schema";

/**
 * State machine for payment_transactions.status.
 *
 * Terminal statuses: success, failed, abandoned, reversed. Once terminal, no
 * further transitions are allowed except `success → reversed` (chargeback).
 * Non-terminal → non-terminal transitions collapse to the more advanced one.
 */
const TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  pending: ["processing", "success", "failed", "abandoned"],
  processing: ["success", "failed", "abandoned"],
  success: ["reversed"],
  failed: [],
  abandoned: [],
  reversed: [],
};

export function isTerminal(status: PaymentStatus): boolean {
  return status === "failed" || status === "abandoned" || status === "reversed";
}

export function canTransition(from: PaymentStatus, to: PaymentStatus): boolean {
  if (from === to) return true;
  return TRANSITIONS[from].includes(to);
}
