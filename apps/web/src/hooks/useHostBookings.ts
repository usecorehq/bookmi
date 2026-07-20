import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Booking } from "@bookmi/shared-types";

/**
 * `kind` is a client-side discriminator only — the backend doesn't accept it
 * yet. Bookings with a slot are real appointments; bookings with `slotStartAt
 * === null` came from the tip flow (PublicCheckoutService never sets a slot
 * on a tip). Once the server-side filter lands, we swap this out for a query
 * param without changing callers.
 */
export type BookingKind = "booking" | "tip";

export interface HostBookingsFilters {
  status?: string;
  source?: string;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
  kind?: BookingKind;
}

export function useHostBookings(filters: HostBookingsFilters = {}) {
  return useQuery({
    queryKey: ["host-bookings", filters],
    queryFn: async () => {
      const { kind, ...serverFilters } = filters;
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(serverFilters)) {
        if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
      }
      const suffix = q.toString() ? `?${q.toString()}` : "";
      const res = await apiFetch<{ items: Booking[] }>(`/hosts/me/bookings${suffix}`);
      if (!kind) return res.items;
      return res.items.filter((b) =>
        kind === "tip" ? b.slotStartAt == null : b.slotStartAt != null,
      );
    },
  });
}
