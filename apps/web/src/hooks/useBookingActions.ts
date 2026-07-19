import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Booking } from "@bookmi/shared-types";
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
 * Debits the host wallet by `amountKobo` and initiates a Monnify disbursement
 * to the customer-supplied bank account. The booking flips to `canceled`
 * (with the refund audit trail attached) on the successful disbursement
 * webhook.
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
      input,
    }: {
      bookingId: string;
      input: RefundBookingInput;
    }) => {
      return apiFetch<{ booking: Booking }>(
        `/hosts/me/bookings/${bookingId}/refund`,
        { method: "POST", body: JSON.stringify(input) },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["host-bookings"] });
      qc.invalidateQueries({ queryKey: ["host-wallet"] });
    },
  });
}
