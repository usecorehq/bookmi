import { randomBytes } from "node:crypto";

/**
 * Environment-aware payment references.
 *
 * Payment providers allow ONE webhook URL per integration mode, but we run
 * several environments against the same mode (dev/staging/sandbox share the
 * test integration). The environment is therefore encoded in the transaction
 * reference itself — the deployment that receives a webhook can route by
 * prefix.
 *
 *   prod     → bookmi_pmt_<id>        (bare — no prefix)
 *   others   → <env>-bookmi_pmt_<id>  (e.g. dev-bookmi_pmt_abc…)
 *
 * The prefix uses '-' only: providers restrict reference charsets (Paystack
 * allows alphanumerics plus - . =), and the bare body keeps its historical
 * shape so prod references never change.
 */

export const PAYMENT_ENVIRONMENTS = ["dev", "staging", "sandbox", "prod"] as const;
export type PaymentEnvironment = (typeof PAYMENT_ENVIRONMENTS)[number];

const NON_PROD: readonly PaymentEnvironment[] = ["dev", "staging", "sandbox"];
const REFERENCE_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** 20 chars of [0-9a-z] (~103 bits), uniform via rejection sampling. */
export function referenceId(length = 20): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      // 252 is the largest multiple of 36 ≤ 256 — reject above it to stay unbiased.
      if (byte < 252) {
        out += REFERENCE_ALPHABET[byte % 36];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

export function buildPaymentReference(env: PaymentEnvironment, id = referenceId()): string {
  const body = `bookmi_pmt_${id}`;
  return env === "prod" ? body : `${env}-${body}`;
}

/**
 * Which environment minted this reference. Anything without a recognized
 * non-prod prefix — including legacy bare references — belongs to prod.
 */
export function environmentFromReference(reference: string): PaymentEnvironment {
  for (const env of NON_PROD) {
    if (reference.startsWith(`${env}-`)) return env;
  }
  return "prod";
}
