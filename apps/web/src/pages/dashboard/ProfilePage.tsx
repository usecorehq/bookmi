import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { FormMessage } from "@/components/ui/FormMessage";
import { useAuth } from "@/contexts/AuthContext";
import { useDebounce } from "@/hooks/useDebounce";
import { apiFetch } from "@/lib/api";
import type { OperatingHours, DayHours, HostProfile } from "@bookmi/shared-types";

const WEEKDAYS: Array<keyof OperatingHours> = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

interface FormState {
  displayName: string;
  slug: string;
  bio: string;
  accentColor: string;
  phone: string;
  address: string;
  operatingHours: OperatingHours;
  bankCode: string;
  bankAccountNumber: string;
  bankAccountName: string;
}

function toForm(profile: HostProfile & { wallet: { bankCode: string | null; bankAccountNumber: string | null; bankAccountName: string | null } | null }): FormState {
  return {
    displayName: profile.displayName,
    slug: profile.slug,
    bio: profile.bio ?? "",
    accentColor: profile.accentColor ?? "#7856FF",
    phone: profile.phone ?? "",
    address: profile.address ?? "",
    operatingHours: profile.operatingHours,
    bankCode: profile.wallet?.bankCode ?? "",
    bankAccountNumber: profile.wallet?.bankAccountNumber ?? "",
    bankAccountName: profile.wallet?.bankAccountName ?? "",
  };
}

export default function ProfilePage() {
  const { profile, refreshProfile } = useAuth();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (profile) setForm(toForm(profile));
  }, [profile]);

  const debouncedSlug = useDebounce(form?.slug ?? "", 400);
  const [slugStatus, setSlugStatus] = useState<"idle" | "checking" | "ok" | "taken" | "invalid" | "self">("idle");

  useEffect(() => {
    if (!form) return;
    const slug = debouncedSlug;
    if (!slug || slug === profile?.slug) {
      setSlugStatus("self");
      return;
    }
    if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?$/.test(slug)) {
      setSlugStatus("invalid");
      return;
    }
    setSlugStatus("checking");
    apiFetch<{ available: boolean }>(`/hosts/slug-available?slug=${encodeURIComponent(slug)}`)
      .then((r) => setSlugStatus(r.available ? "ok" : "taken"))
      .catch(() => setSlugStatus("invalid"));
  }, [debouncedSlug, profile?.slug, form]);

  const saveMutation = useMutation({
    mutationFn: async (patch: Record<string, unknown>) => {
      const res = await apiFetch<{ profile: HostProfile }>("/hosts/me/profile", {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
      return res.profile;
    },
    onSuccess: async () => {
      toast.success("Profile updated");
      setError(null);
      await refreshProfile();
      queryClient.invalidateQueries({ queryKey: ["host-wallet"] });
    },
    onError: (err) => {
      setError(readError(err));
    },
  });

  const canSave = form && slugStatus !== "checking" && slugStatus !== "taken" && slugStatus !== "invalid";

  if (!profile || !form) {
    return <div className="text-sm text-muted-foreground">Loading…</div>;
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    // Only send fields that changed.
    const original = toForm(profile);
    const patch: Record<string, unknown> = {};
    if (form.displayName !== original.displayName) patch.displayName = form.displayName;
    if (form.slug !== original.slug) patch.slug = form.slug;
    if (form.bio !== original.bio) patch.bio = form.bio || null;
    if (form.accentColor !== original.accentColor) patch.accentColor = form.accentColor;
    if (form.phone !== original.phone) patch.phone = form.phone || null;
    if (form.address !== original.address) patch.address = form.address || null;
    if (JSON.stringify(form.operatingHours) !== JSON.stringify(original.operatingHours)) {
      patch.operatingHours = form.operatingHours;
    }
    if (form.bankCode !== original.bankCode) patch.bankCode = form.bankCode || null;
    if (form.bankAccountNumber !== original.bankAccountNumber)
      patch.bankAccountNumber = form.bankAccountNumber || null;
    if (form.bankAccountName !== original.bankAccountName)
      patch.bankAccountName = form.bankAccountName || null;

    if (Object.keys(patch).length === 0) {
      toast("Nothing to save");
      return;
    }
    saveMutation.mutate(patch);
  };

  return (
    <div>
      <PageHeader
        title="Profile"
        subtitle="How your Bookmi page looks + when customers can book."
      />

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Identity */}
        <Section title="Identity">
          <Field label="Display name">
            <input
              className="input-field"
              value={form.displayName}
              onChange={(e) => setForm({ ...form, displayName: e.target.value })}
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
                value={form.slug}
                onChange={(e) =>
                  setForm({
                    ...form,
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
              value={form.bio}
              onChange={(e) => setForm({ ...form, bio: e.target.value })}
              maxLength={500}
              placeholder="Nail artist in Yaba, DM for house calls."
            />
          </Field>
          <Field label="Accent color" hint="Overlay on the public page.">
            <div className="flex items-center gap-3">
              <input
                type="color"
                className="w-12 h-12 border border-gray-200 rounded-none cursor-pointer"
                value={form.accentColor}
                onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
              />
              <input
                className="input-field"
                value={form.accentColor}
                onChange={(e) => setForm({ ...form, accentColor: e.target.value })}
                pattern="^#[0-9A-Fa-f]{6}$"
                maxLength={7}
              />
            </div>
          </Field>
        </Section>

        {/* Contact */}
        <Section title="Contact — shown on the public page">
          <Field label="Phone">
            <input
              className="input-field"
              value={form.phone}
              onChange={(e) => setForm({ ...form, phone: e.target.value })}
              placeholder="+2348012345678"
              maxLength={40}
            />
          </Field>
          <Field label="Address">
            <input
              className="input-field"
              value={form.address}
              onChange={(e) => setForm({ ...form, address: e.target.value })}
              placeholder="123 Opebi Road, Ikeja, Lagos"
              maxLength={200}
            />
          </Field>
        </Section>

        {/* Operating hours */}
        <Section title="Operating hours" subtitle="Feeds the customer wizard's calendar.">
          <div className="space-y-2">
            {WEEKDAYS.map((day) => (
              <HoursRow
                key={day}
                day={day}
                value={form.operatingHours[day]}
                onChange={(v) =>
                  setForm({
                    ...form,
                    operatingHours: { ...form.operatingHours, [day]: v },
                  })
                }
              />
            ))}
          </div>
        </Section>

        {/* Payout */}
        <Section title="Payout details" subtitle="Where withdrawals land.">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Field label="Bank code">
              <input
                className="input-field"
                value={form.bankCode}
                onChange={(e) => setForm({ ...form, bankCode: e.target.value })}
                placeholder="058"
                maxLength={10}
              />
            </Field>
            <Field label="Account number">
              <input
                className="input-field"
                value={form.bankAccountNumber}
                onChange={(e) => setForm({ ...form, bankAccountNumber: e.target.value })}
                placeholder="0123456789"
                maxLength={20}
              />
            </Field>
            <Field label="Account name">
              <input
                className="input-field"
                value={form.bankAccountName}
                onChange={(e) => setForm({ ...form, bankAccountName: e.target.value })}
                placeholder="Ada Bookings"
                maxLength={80}
              />
            </Field>
          </div>
        </Section>

        {error && <FormMessage variant="error" message={error} />}

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={!canSave || saveMutation.isPending}
            className="btn-primary"
          >
            {saveMutation.isPending ? "Saving…" : "Save changes"}
          </button>
        </div>
      </form>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
      </div>
      <div className="space-y-4">{children}</div>
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

function HoursRow({
  day,
  value,
  onChange,
}: {
  day: keyof OperatingHours;
  value: DayHours;
  onChange: (v: DayHours) => void;
}) {
  return (
    <div className="grid grid-cols-[7rem_auto_1fr_auto_1fr] items-center gap-3">
      <label className="text-sm font-medium capitalize">{day}</label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={!value.closed}
          onChange={(e) => onChange({ ...value, closed: !e.target.checked })}
        />
        Open
      </label>
      <input
        type="time"
        value={value.open}
        onChange={(e) => onChange({ ...value, open: e.target.value })}
        disabled={value.closed}
        className="input-field !min-h-[36px] !py-1"
      />
      <span className="text-xs text-muted-foreground">to</span>
      <input
        type="time"
        value={value.close}
        onChange={(e) => onChange({ ...value, close: e.target.value })}
        disabled={value.closed}
        className="input-field !min-h-[36px] !py-1"
      />
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
        return { icon: <Loader2 className="w-3 h-3 animate-spin" />, text: "Checking…", cls: "text-muted-foreground" };
      case "ok":
        return { icon: <Check className="w-3 h-3" />, text: "Available", cls: "text-green-700" };
      case "taken":
        return { icon: <X className="w-3 h-3" />, text: "Already taken", cls: "text-red-700" };
      case "invalid":
        return { icon: <X className="w-3 h-3" />, text: "Use letters, numbers, hyphens only.", cls: "text-red-700" };
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
