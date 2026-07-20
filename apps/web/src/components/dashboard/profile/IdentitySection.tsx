import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { FormMessage } from "@/components/ui/FormMessage";
import { AvatarUploader } from "@/components/upload/AvatarUploader";
import { useAuth } from "@/contexts/AuthContext";
import { useDebounce } from "@/hooks/useDebounce";
import { apiFetch } from "@/lib/api";
import type { HostProfile, HostWallet } from "@bookmi/shared-types";

type ProfileWithWallet = HostProfile & { wallet: HostWallet | null };

interface Draft {
  displayName: string;
  slug: string;
  bio: string;
  avatarUrl: string;
  accentColor: string;
}

function toDraft(profile: ProfileWithWallet): Draft {
  return {
    displayName: profile.displayName,
    slug: profile.slug,
    bio: profile.bio ?? "",
    avatarUrl: profile.avatarUrl ?? "",
    accentColor: profile.accentColor ?? "#7856FF",
  };
}

export function IdentitySection({ profile }: { profile: ProfileWithWallet }) {
  const { refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(toDraft(profile));
  }, [profile]);

  const debouncedSlug = useDebounce(draft.slug, 400);
  const [slugStatus, setSlugStatus] = useState<
    "idle" | "checking" | "ok" | "taken" | "invalid" | "self"
  >("self");

  useEffect(() => {
    const slug = debouncedSlug;
    if (!slug || slug === profile.slug) {
      setSlugStatus("self");
      return;
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/.test(slug)) {
      setSlugStatus("invalid");
      return;
    }
    setSlugStatus("checking");
    apiFetch<{ available: boolean }>(
      `/hosts/slug-available?slug=${encodeURIComponent(slug)}`,
    )
      .then((r) => setSlugStatus(r.available ? "ok" : "taken"))
      .catch(() => setSlugStatus("invalid"));
  }, [debouncedSlug, profile.slug]);

  const original = useMemo(() => toDraft(profile), [profile]);
  const patch = useMemo<Record<string, unknown>>(() => {
    const p: Record<string, unknown> = {};
    if (draft.displayName !== original.displayName) p.displayName = draft.displayName;
    if (draft.slug !== original.slug) p.slug = draft.slug;
    if (draft.bio !== original.bio) p.bio = draft.bio || null;
    if (draft.avatarUrl !== original.avatarUrl) p.avatarUrl = draft.avatarUrl || null;
    if (draft.accentColor !== original.accentColor) p.accentColor = draft.accentColor;
    return p;
  }, [draft, original]);

  const hasChanges = Object.keys(patch).length > 0;
  const slugBlocks =
    slugStatus === "checking" || slugStatus === "taken" || slugStatus === "invalid";

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

  const canSave = hasChanges && !slugBlocks && !saveMutation.isPending;

  const initials = draft.displayName
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div className="card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Identity</h2>
        <p className="text-sm text-muted-foreground mt-0.5">
          How you appear on your public Bookmi page.
        </p>
      </div>

      <div className="space-y-4">
        <Field label="Photo" hint="Shown on your public page. JPG, PNG, or WebP · up to 3 MB.">
          <AvatarUploader
            value={draft.avatarUrl || null}
            onUploaded={(url) => setDraft({ ...draft, avatarUrl: url })}
            initials={initials}
            accentColor={draft.accentColor}
            folder="bookmi/avatars"
            size={80}
          />
        </Field>

        <Field label="Display name">
          <input
            className="input-field"
            value={draft.displayName}
            onChange={(e) => setDraft({ ...draft, displayName: e.target.value })}
            maxLength={80}
            required
          />
        </Field>

        <Field label="Bookmi link" hint="Change carefully — old links break.">
          <div className="flex items-stretch">
            <span className="inline-flex items-center px-3 border border-r-0 border-gray-200 bg-gray-50 text-sm text-muted-foreground select-none">
              book.me/
            </span>
            <input
              className="input-field flex-1"
              value={draft.slug}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""),
                })
              }
              maxLength={30}
              required
            />
          </div>
          <SlugHint status={slugStatus} />
        </Field>

        <Field label="Bio" hint="Shown on your public page. Markdown NOT supported yet.">
          <textarea
            className="input-field min-h-[100px]"
            value={draft.bio}
            onChange={(e) => setDraft({ ...draft, bio: e.target.value })}
            maxLength={500}
            placeholder="Nail artist in Yaba, DM for house calls."
          />
        </Field>

        <Field label="Accent color" hint="Overlay on the public page.">
          <div className="flex items-center gap-3">
            <input
              type="color"
              className="w-12 h-12 border border-gray-200 rounded-none cursor-pointer"
              value={draft.accentColor}
              onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
            />
            <input
              className="input-field"
              value={draft.accentColor}
              onChange={(e) => setDraft({ ...draft, accentColor: e.target.value })}
              pattern="^#[0-9A-Fa-f]{6}$"
              maxLength={7}
            />
          </div>
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

function SlugHint({
  status,
}: {
  status: "idle" | "checking" | "ok" | "taken" | "invalid" | "self";
}) {
  const label = useMemo(() => {
    switch (status) {
      case "checking":
        return {
          icon: <Loader2 className="w-3 h-3 animate-spin" />,
          text: "Checking…",
          cls: "text-muted-foreground",
        };
      case "ok":
        return {
          icon: <Check className="w-3 h-3" />,
          text: "Available",
          cls: "text-green-700",
        };
      case "taken":
        return {
          icon: <X className="w-3 h-3" />,
          text: "Already taken",
          cls: "text-red-700",
        };
      case "invalid":
        return {
          icon: <X className="w-3 h-3" />,
          text: "Use letters, numbers, hyphens only.",
          cls: "text-red-700",
        };
      default:
        return null;
    }
  }, [status]);
  if (!label) return null;
  return (
    <p className={`text-xs mt-1.5 inline-flex items-center gap-1.5 ${label.cls}`}>
      {label.icon}
      {label.text}
    </p>
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
