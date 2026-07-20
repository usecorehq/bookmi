import { useQuery } from "@tanstack/react-query";
import type { PublicHostView, PublicServiceView } from "@bookmi/shared-types";
import { env } from "@/lib/env";

export interface PublicHostResponse {
  host: PublicHostView;
  services: PublicServiceView[];
}

export interface PublicServiceResponse {
  host: PublicHostView;
  service: PublicServiceView;
}

/**
 * Anonymous fetcher — public routes accept no token, so we bypass the
 * `apiFetch` helper (which adds the auth header) and hit the API directly.
 */
async function publicFetch<T>(path: string): Promise<T> {
  const res = await fetch(`${env.apiUrl}/api${path}`, {
    headers: { "Content-Type": "application/json" },
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    const message =
      (typeof body === "object" && body && "message" in body && String(body.message)) ||
      `API ${res.status} on ${path}`;
    const err = new Error(message);
    (err as Error & { status?: number; body?: unknown }).status = res.status;
    (err as Error & { status?: number; body?: unknown }).body = body;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function usePublicHost(slug: string | undefined) {
  return useQuery({
    queryKey: ["public-host", slug],
    enabled: !!slug,
    queryFn: () => publicFetch<PublicHostResponse>(`/public/${slug}`),
  });
}

export function usePublicService(slug: string | undefined, serviceSlug: string | undefined) {
  return useQuery({
    queryKey: ["public-service", slug, serviceSlug],
    enabled: !!slug && !!serviceSlug,
    queryFn: () =>
      publicFetch<PublicServiceResponse>(`/public/${slug}/${serviceSlug}`),
  });
}
