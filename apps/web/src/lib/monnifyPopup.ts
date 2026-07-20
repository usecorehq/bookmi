import Monnify from "monnify-js";
import { getMonnifyEnv } from "./env";

export class MonnifyPopupCancelled extends Error {
  constructor() {
    super("Payment was cancelled");
    this.name = "MonnifyPopupCancelled";
  }
}

export interface MonnifyPopupInput {
  /** From PaymentsService.initiate — the bookmi reference we track. */
  reference: string;
  /** In naira (major units). Bookmi's API returns amountMinor in kobo — divide before passing. */
  amount: number;
  currency?: string;
  customerName: string;
  customerEmail: string;
  paymentDescription?: string;
  metadata?: Record<string, unknown>;
  /** Fallback for browsers where the SDK can't open. */
  authorizationUrl?: string;
}

/**
 * Monnify wrapper contract (`monnify-js` reads them off the SDK constructor,
 * not the initializePayment payload):
 *   new Monnify(apiKey, contractCode)
 *   monnify.initializePayment({
 *     amount, currency, reference,
 *     customerFullName,       // ← NOT `customerName` — wrapper silently
 *                             //   rejects with "Missing required field"
 *     customerEmail,
 *     paymentDescription,
 *     onComplete?, onClose?,
 *   })
 * Test-mode vs live is auto-picked from the key prefix (`MK_TEST_…`).
 */
export function payWithMonnifyPopup(
  input: MonnifyPopupInput,
): Promise<{ reference: string }> {
  return new Promise((resolve, reject) => {
    const redirectFallback = () => {
      if (input.authorizationUrl) {
        window.location.href = input.authorizationUrl;
        return true;
      }
      return false;
    };

    let apiKey: string;
    let contractCode: string;
    try {
      ({ apiKey, contractCode } = getMonnifyEnv());
    } catch (err) {
      if (redirectFallback()) return;
      reject(err instanceof Error ? err : new Error("Monnify env missing"));
      return;
    }

    try {
      let settled = false;
      const monnify = new Monnify(apiKey, contractCode);
      monnify.initializePayment({
        amount: input.amount,
        currency: input.currency ?? "NGN",
        reference: input.reference,
        customerFullName: input.customerName || input.customerEmail,
        customerEmail: input.customerEmail,
        paymentDescription: input.paymentDescription ?? "Bookmi",
        metadata: input.metadata,
        onComplete: (response: {
          paymentReference?: string;
          transactionReference?: string;
        }) => {
          if (settled) return;
          settled = true;
          resolve({
            reference:
              response?.paymentReference ||
              response?.transactionReference ||
              input.reference,
          });
        },
        onClose: () => {
          if (settled) return;
          settled = true;
          reject(new MonnifyPopupCancelled());
        },
      });
    } catch (err) {
      if (redirectFallback()) return;
      reject(err instanceof Error ? err : new Error("Monnify SDK failed to open"));
    }
  });
}
