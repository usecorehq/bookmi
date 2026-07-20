import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FormMessage } from "@/components/ui/FormMessage";
import { useAuth } from "@/contexts/AuthContext";
import { apiFetch } from "@/lib/api";
import type { HostProfile, HostWallet } from "@bookmi/shared-types";

type ProfileWithWallet = HostProfile & { wallet: HostWallet | null };

interface Draft {
  phone: string;
  address: string;
}

function toDraft(profile: ProfileWithWallet): Draft {
  return {
    phone: profile.phone ?? "",
    address: profile.address ?? "",
  };
}

export function ContactSection({ profile }: { profile: ProfileWithWallet }) {
  const { refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(toDraft(profile));
  }, [profile]);

  const original = useMemo(() => toDraft(profile), [profile]);
  const patch = useMemo<Record<string, unknown>>(() => {
    const p: Record<string, unknown> = {};
    if (draft.phone !== original.phone) p.phone = draft.phone || null;
    if (draft.address !== original.address) p.address = draft.address || null;
    return p;
  }, [draft, original]);

  const hasChanges = Object.keys(patch).length > 0;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiFetch<{ profile: HostProfile }>("/hosts/me/profile", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      return res.profile;
    },
    onSuccess: async () => {
      toast.success("Saved");
      setError(null);
      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: ["host-wallet"] });
    },
    onError: (err) => {
      setError(readError(err));
    },
  });

  const canSave = hasChanges && !saveMutation.isPending;

  return (
    <div className="card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Contact</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          Shown on the public page so customers can reach you.
        </p>
      </div>

      <div className="space-y-4">
        <Field label="Phone">
          <input
            className="input-field"
            value={draft.phone}
            onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
            placeholder="+2348012345678"
            maxLength={40}
          />
        </Field>

        <Field label="Address">
          <input
            className="input-field"
            value={draft.address}
            onChange={(e) => setDraft({ ...draft, address: e.target.value })}
            placeholder="123 Opebi Road, Ikeja, Lagos"
            maxLength={200}
          />
        </Field>

        {error && <FormMessage variant="error" message={error} />}

        <div className="flex justify-end pt-2">
          <button
            type="button"
            disabled={!canSave}
            onClick={() => saveMutation.mutate()}
            className="btn-primary"
          >
            {saveMutation.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1.5">{hint}</p>}
    </div>
  );
}

function readError(err: unknown): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: unknown }).body;
    if (body && typeof body === "object" && "message" in body) {
      const m = (body as { message?: unknown }).message;
      if (typeof m === "string") return m;
      if (Array.isArray(m)) return m.join(", ");
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
