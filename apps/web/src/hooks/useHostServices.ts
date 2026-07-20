import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiFetch } from "@/lib/api";
import type {
  CreateServiceInput,
  Service,
  UpdateServiceInput,
} from "@bookmi/shared-types";

const KEY = ["host-services"] as const;

export function useHostServices() {
  return useQuery({
    queryKey: KEY,
    queryFn: async () => {
      const res = await apiFetch<{ items: Service[] }>("/hosts/me/services");
      return res.items;
    },
  });
}

export function useCreateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: CreateServiceInput) => {
      const res = await apiFetch<{ service: Service }>("/hosts/me/services", {
        method: "POST",
        body: JSON.stringify(input),
      });
      return res.service;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useUpdateService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: UpdateServiceInput }) => {
      const res = await apiFetch<{ service: Service }>(`/hosts/me/services/${id}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      return res.service;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

export function useDeleteService() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await apiFetch<void>(`/hosts/me/services/${id}`, { method: "DELETE" });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
