import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { Booking } from "@bookmi/shared-types";
import { apiFetch } from "@/lib/api";

/**
 * PATCH /hosts/me/bookings/:id — advances a booking through its lifecycle,
 * or overwrites `customerNotes`. Backend returns 400 on invalid transitions,
 * which the caller should surface as a `toast.error`.
 */
export function useUpdateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      patch,
    }: {
      id: string;
      patch: { status?: string; customerNotes?: string | null };
    }) => {
      return apiFetch<{ booking: Booking }>(`/hosts/me/bookings/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["host-bookings"] }),
  });
}

export interface CreateBookingInput {
  serviceIds: string[];
  durationMinutes: number;
  customerName: string;
  customerPhone: string;
  customerEmail?: string;
  customerNotes?: string;
  slotStartAt: string;
}

/**
 * POST /hosts/me/bookings — manual booking creation from the dashboard.
 * Backend sums `amountKobo` from the selected services, marks
 * `source='dashboard'`, `status='confirmed'`.
 */
export function useCreateBooking() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateBookingInput) => {
      return apiFetch<{ booking: Booking }>("/hosts/me/bookings", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["host-bookings"] }),
  });
}
