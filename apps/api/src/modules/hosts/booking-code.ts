import { randomBytes } from "node:crypto";

/**
 * Short customer-facing booking handle, e.g. "X8-GAFJ".
 *
 * Alphabet is Crockford-inspired: no `0/O`, `1/I/L`, `U` (looks like V handwritten).
 * Length gives ~30 bits — plenty for the ~10k bookings a single host is likely
 * to accumulate. Global collisions are rejected by the `bookings.code` UNIQUE
 * constraint; callers retry on 23505 once.
 */
const ALPHABET = "ABCDEFGHJKLMNPQRSTVWXYZ23456789";

function pick(length: number): string {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length)) {
      // 248 is the largest multiple of 31 <= 256; reject above to stay unbiased.
      if (byte < 248) {
        out += ALPHABET[byte % ALPHABET.length];
        if (out.length === length) break;
      }
    }
  }
  return out;
}

/** Formatted as `XX-YYYY` — two chars, hyphen, four chars. */
export function generateBookingCode(): string {
  return `${pick(2)}-${pick(4)}`;
}
