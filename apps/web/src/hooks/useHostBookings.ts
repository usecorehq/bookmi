import { useQuery } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type { Booking } from "@bookmi/shared-types";

export interface HostBookingsFilters {
  status?: string;
  source?: string;
  from?: string;
  to?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

export function useHostBookings(filters: HostBookingsFilters = {}) {
  return useQuery({
    queryKey: ["host-bookings", filters],
    queryFn: async () => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(filters)) {
        if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
      }
      const suffix = q.toString() ? `?${q.toString()}` : "";
      const res = await apiFetch<{ items: Booking[] }>(`/hosts/me/bookings${suffix}`);
      return res.items;
    },
  });
}
