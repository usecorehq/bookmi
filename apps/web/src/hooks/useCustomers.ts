import { useQuery } from "@tanstack/react-query";
import type { Customer } from "@bookmi/shared-types";
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
