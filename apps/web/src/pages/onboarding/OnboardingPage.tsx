import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { AuthLayout } from "@/components/layouts/AuthLayout";
import { FormMessage } from "@/components/ui/FormMessage";
import { AvatarUploader } from "@/components/upload/AvatarUploader";
import { useAuth } from "@/contexts/AuthContext";
import { useDebounce } from "@/hooks/useDebounce";
import { apiFetch } from "@/lib/api";
import type { HostProfile } from "@bookmi/shared-types";

/**
 * One-screen wizard:
 *   Display name → auto-generated slug (editable) → live availability check
 *   → Continue → POST /hosts/me/profile → refreshProfile → /dashboard.
 *
 * Reserved words + charset rules are enforced server-side too — this UI
 * mirrors them so the user sees red early instead of a 400 on submit.
 */
export default function OnboardingPage() {
  const navigate = useNavigate();
  const { user, profile, refreshProfile } = useAuth();

  const [displayName, setDisplayName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [avatarUrl, setAvatarUrl] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Prefill display name from Supabase user metadata / email local-part.
  useEffect(() => {
    if (displayName) return;
    const meta = (user?.user_metadata as { full_name?: string } | undefined)?.full_name;
    const emailPart = user?.email?.split("@")[0];
    const suggested = meta || emailPart || "";
    if (suggested) setDisplayName(suggested);
  }, [user, displayName]);

  // Slug follows displayName until the user manually edits it.
  useEffect(() => {
    if (slugTouched) return;
    setSlug(slugify(displayName));
  }, [displayName, slugTouched]);

  // If they already have a profile, don't let them re-onboard.
  useEffect(() => {
    if (profile) navigate("/dashboard", { replace: true });
  }, [profile, navigate]);

  const debouncedSlug = useDebounce(slug, 400);
  const shapeError = useMemo(() => validateSlugShape(debouncedSlug), [debouncedSlug]);

  const availabilityQuery = useQuery({
    queryKey: ["slug-available", debouncedSlug],
    enabled: !!debouncedSlug && !shapeError,
    queryFn: () =>
      apiFetch<{ available: boolean; reason?: string }>(
        `/hosts/slug-available?slug=${encodeURIComponent(debouncedSlug)}`,
      ),
  });

  const availability: SlugState = shapeError
    ? { state: "invalid", message: shapeError }
    : !debouncedSlug
      ? { state: "idle" }
      : availabilityQuery.isPending
        ? { state: "checking" }
        : availabilityQuery.isError
          ? { state: "error", message: "Could not check availability." }
          : availabilityQuery.data?.available
            ? { state: "available" }
            : {
                state: "taken",
                message: availabilityQuery.data?.reason ?? "That slug is already taken.",
              };

  const canSubmit =
    displayName.trim().length > 0 &&
    availability.state === "available" &&
    !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      // POST creates the profile with just slug + displayName. If the user
      // uploaded an avatar, we PATCH it in a second call — kept separate so a
      // failed avatar PATCH can't roll back the (already-durable) profile row.
      await apiFetch<{ profile: HostProfile }>("/hosts/me/profile", {
        method: "POST",
        body: JSON.stringify({ slug: debouncedSlug, displayName: displayName.trim() }),
      });
      if (avatarUrl) {
        try {
          await apiFetch<{ profile: HostProfile }>("/hosts/me/profile", {
            method: "PATCH",
            body: JSON.stringify({ avatarUrl }),
          });
        } catch (patchErr) {
          console.error("Avatar PATCH after profile create failed:", patchErr);
          // Non-fatal — user still has a valid profile; they can add the
          // photo again on the profile page.
        }
      }
      await refreshProfile();
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(readError(err));
    } finally {
      setSubmitting(false);
    }
  };

  const avatarInitials = displayName
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <AuthLayout>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Bookmi</h1>
          <p className="text-sm text-muted-foreground mt-1">by Qorelly</p>
        </div>

        <div className="card p-8">
          <h2 className="text-2xl font-semibold mb-1">Claim your page</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Pick a name and a link. You can edit both later.
          </p>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="flex justify-center pb-2">
              <AvatarUploader
                value={avatarUrl || null}
                onUploaded={(url) => setAvatarUrl(url)}
                initials={avatarInitials}
                folder="bookmi/avatars"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Display name</label>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="input-field"
                placeholder="Ada's Studio"
                maxLength={80}
                required
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-1.5">
                Shown on your public page and in confirmation emails.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium mb-2">Your Bookmi link</label>
              <div className="flex items-stretch">
                <span className="inline-flex items-center px-3 border border-r-0 border-gray-200 bg-gray-50 text-sm text-muted-foreground select-none">
                  book.me/
                </span>
                <input
                  type="text"
                  value={slug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setSlug(sanitizeSlugInput(e.target.value));
                  }}
                  className="input-field flex-1"
                  placeholder="your-name"
                  maxLength={30}
                  required
                />
              </div>
              <div className="mt-1.5 min-h-[1.25rem] text-xs">
                <SlugStatus state={availability} />
              </div>
            </div>

            {error && <FormMessage variant="error" message={error} />}

            <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
              {submitting ? "Setting up…" : "Continue to dashboard"}
            </button>
          </form>
        </div>
      </div>
    </AuthLayout>
  );
}

// ─── slug helpers ──────────────────────────────────────────────────────

/** Suggest a slug from a display name. Mirrors qore-menu's generateSlug. */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 30);
}

/** Filter keystrokes to the allowed charset while the user types. */
function sanitizeSlugInput(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .replace(/^-+/, "")
    .slice(0, 30);
}

/** Client-side mirror of the server's Zod SlugSchema for a fast red state. */
function validateSlugShape(slug: string): string | null {
  if (!slug) return null;
  if (slug.length < 3) return "Slug must be at least 3 characters.";
  if (slug.length > 30) return "Slug must be at most 30 characters.";
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/.test(slug)) {
    return "Slug can only use lowercase letters, numbers, and hyphens.";
  }
  return null;
}

type SlugState =
  | { state: "idle" }
  | { state: "checking" }
  | { state: "invalid"; message: string }
  | { state: "taken"; message: string }
  | { state: "available" }
  | { state: "error"; message: string };

function SlugStatus({ state }: { state: SlugState }) {
  switch (state.state) {
    case "idle":
      return null;
    case "checking":
      return (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          Checking…
        </span>
      );
    case "available":
      return (
        <span className="inline-flex items-center gap-1.5 text-green-700">
          <Check className="w-3 h-3" />
          Available
        </span>
      );
    case "taken":
    case "invalid":
    case "error":
      return (
        <span className="inline-flex items-center gap-1.5 text-red-700">
          <X className="w-3 h-3" />
          {state.message}
        </span>
      );
  }
}

function readError(err: unknown): string {
  if (err && typeof err === "object" && "body" in err) {
    const body = (err as { body?: unknown }).body;
    if (body && typeof body === "object" && "message" in body) {
      const m = (body as { message?: unknown }).message;
      if (typeof m === "string") return m;
    }
  }
  return err instanceof Error ? err.message : "Something went wrong.";
}
