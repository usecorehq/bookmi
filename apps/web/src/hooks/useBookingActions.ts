import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Booking, Refund } from "@bookmi/shared-types";
import { apiFetch } from "@/lib/api";

/**
 * POST /api/hosts/me/bookings/:id/send-payment-link
 *
 * Backend enqueues a booking_payment_link email to the customer's address.
 * The email contains a unique /pay/:bookingId link that resumes the exact
 * pending booking — no new row is created, and on successful payment the
 * existing booking flips to confirmed.
 */
export function useSendPaymentLink() {
  return useMutation({
    mutationFn: async (bookingId: string) => {
      return apiFetch<{ ok: true; email: string }>(
        `/hosts/me/bookings/${bookingId}/send-payment-link`,
        { method: "POST" },
      );
    },
  });
}

/**
 * POST /api/hosts/me/bookings/:id/refund
 *
 * The client mints an idempotency key up-front (uuid v4 in the modal); a
 * retried request with the same key hits the server-side ledger cache
 * instead of a second disbursement. The OTP code is single-use — a fresh
 * one is required for a NEW idempotency key, not for a retry.
 *
 * Headers, not body, so the shape mirrors the withdraw endpoint (which
 * takes no other body params beyond amount).
 */
export interface RefundBookingInput {
  bankCode: string;
  accountNumber: string;
  accountName: string;
  amountKobo: number;
  reason?: string;
}

export function useRefundBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      bookingId,
      idempotencyKey,
      otpCode,
      input,
    }: {
      bookingId: string;
      idempotencyKey: string;
      otpCode: string;
      input: RefundBookingInput;
    }) => {
      return apiFetch<{ refund: Refund; booking: Booking | null }>(
        `/hosts/me/bookings/${bookingId}/refund`,
        {
          method: "POST",
          body: JSON.stringify(input),
          headers: {
            "X-Idempotency-Key": idempotencyKey,
            "X-OTP-Code": otpCode,
          },
        },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["host-bookings"] });
      qc.invalidateQueries({ queryKey: ["host-wallet"] });
    },
  });
}
