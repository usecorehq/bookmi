import { useQuery } from "@tanstack/react-query";
import type { Booking, Customer } from "@bookmi/shared-types";
import { apiFetch } from "@/lib/api";

export function useHostCustomers(opts: { limit?: number; offset?: number } = {}) {
  return useQuery({
    queryKey: ["host-customers", opts],
    queryFn: async () => {
      const q = new URLSearchParams();
      if (opts.limit != null) q.set("limit", String(opts.limit));
      if (opts.offset != null) q.set("offset", String(opts.offset));
      const suffix = q.toString() ? `?${q.toString()}` : "";
      const res = await apiFetch<{ items: Customer[] }>(
        `/hosts/me/customers${suffix}`,
      );
      return res.items;
    },
  });
}

/**
 * Debounced-by-caller search. Returns `[]` for terms shorter than 2 chars
 * so the caller doesn't need to guard.
 */
export function useCustomerSearch(term: string) {
  const enabled = term.trim().length >= 2;
  return useQuery({
    queryKey: ["host-customer-search", term],
    enabled,
    queryFn: async () => {
      const res = await apiFetch<{ items: Customer[] }>(
        `/hosts/me/customers?q=${encodeURIComponent(term.trim())}`,
      );
      return res.items;
    },
  });
}

/** Single-customer detail. Disabled while `id` is undefined. */
export function useCustomer(id: string | undefined) {
  return useQuery({
    queryKey: ["host-customer", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await apiFetch<{ customer: Customer }>(
        `/hosts/me/customers/${id}`,
      );
      return res.customer;
    },
  });
}

/** Every booking (incl. tips) the customer has made with the host. Newest first. */
export function useCustomerBookings(id: string | undefined) {
  return useQuery({
    queryKey: ["host-customer-bookings", id],
    enabled: !!id,
    queryFn: async () => {
      const res = await apiFetch<{ items: Booking[] }>(
        `/hosts/me/customers/${id}/bookings`,
      );
      return res.items;
    },
  });
}
