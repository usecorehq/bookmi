import { useEffect, useMemo, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Clock,
  Loader2,
  Check,
  Copy,
  Coffee,
  CalendarDays,
} from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { FormMessage } from "@/components/ui/FormMessage";
import { useAuth } from "@/contexts/AuthContext";
import {
  useCreateService,
  useDeleteService,
  useHostServices,
  useUpdateService,
} from "@/hooks/useHostServices";
import { formatNaira } from "@/lib/utils";
import type { Service, ServiceType } from "@bookmi/shared-types";

type ServicesTab = "booking" | "tip";

export default function ServicesPage() {
  const { profile } = useAuth();
  const servicesQ = useHostServices();
  const [tab, setTab] = useState<ServicesTab>("booking");
  const [editing, setEditing] = useState<{ mode: "new"; type: ServiceType } | Service | null>(
    null,
  );
  const [confirmDelete, setConfirmDelete] = useState<Service | null>(null);
  const updateMutation = useUpdateService();
  const deleteMutation = useDeleteService();

  const { bookings, tips } = useMemo(() => {
    const list = servicesQ.data ?? [];
    return {
      bookings: list.filter((s) => s.type === "booking"),
      tips: list.filter((s) => s.type === "tip"),
    };
  }, [servicesQ.data]);

  const handleToggleActive = (service: Service, active: boolean) => {
    updateMutation.mutate(
      { id: service.id, patch: { active } },
      {
        onSuccess: () => toast.success(active ? "Made visible" : "Hidden from your page"),
        onError: (err) => toast.error(readError(err)),
      },
    );
  };

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteMutation.mutate(confirmDelete.id, {
      onSuccess: () => {
        toast.success("Deleted");
        setConfirmDelete(null);
      },
      onError: (err) => toast.error(readError(err)),
    });
  };

  const hostSlug = profile?.slug ?? "";

  return (
    <div>
      <PageHeader
        title="Services"
        subtitle="Bookable services show up in the wizard. Tips are one-tap payments — no calendar."
        actions={
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setEditing({ mode: "new", type: "tip" })}
              className="btn-secondary inline-flex items-center gap-2"
            >
              <Coffee className="w-4 h-4" /> New tip
            </button>
            <button
              type="button"
              onClick={() => setEditing({ mode: "new", type: "booking" })}
              className="btn-primary inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> New service
            </button>
          </div>
        }
      />

      {servicesQ.isPending ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : servicesQ.isError ? (
        <FormMessage variant="error" message="Couldn't load services." />
      ) : (servicesQ.data ?? []).length === 0 ? (
        <EmptyState
          onNewBooking={() => setEditing({ mode: "new", type: "booking" })}
          onNewTip={() => setEditing({ mode: "new", type: "tip" })}
        />
      ) : (
        <>
          <div className="mb-5 inline-flex bg-gray-100 p-1">
            <TabButton active={tab === "booking"} onClick={() => setTab("booking")}>
              <CalendarDays className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Bookable services
              <span className="ml-1.5 text-xs opacity-70">· {bookings.length}</span>
            </TabButton>
            <TabButton active={tab === "tip"} onClick={() => setTab("tip")}>
              <Coffee className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              Tips &amp; donations
              <span className="ml-1.5 text-xs opacity-70">· {tips.length}</span>
            </TabButton>
          </div>

          {tab === "booking" ? (
            <Group
              subtitle="Customers pick a date + time in the wizard."
              emptyLabel="No bookable services yet."
              items={bookings}
              renderCard={(service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  hostSlug={hostSlug}
                  onEdit={() => setEditing(service)}
                  onDelete={() => setConfirmDelete(service)}
                  onToggleActive={(active) => handleToggleActive(service, active)}
                  busy={
                    (updateMutation.isPending && updateMutation.variables?.id === service.id) ||
                    (deleteMutation.isPending && deleteMutation.variables === service.id)
                  }
                />
              )}
            />
          ) : (
            <Group
              subtitle="Direct-share link, pay what you want, no calendar."
              emptyLabel="No tip options yet."
              items={tips}
              renderCard={(service) => (
                <ServiceCard
                  key={service.id}
                  service={service}
                  hostSlug={hostSlug}
                  onEdit={() => setEditing(service)}
                  onDelete={() => setConfirmDelete(service)}
                  onToggleActive={(active) => handleToggleActive(service, active)}
                  busy={
                    (updateMutation.isPending && updateMutation.variables?.id === service.id) ||
                    (deleteMutation.isPending && deleteMutation.variables === service.id)
                  }
                />
              )}
            />
          )}
        </>
      )}

      {editing && (
        <ServiceFormModal
          service={"mode" in editing ? null : editing}
          initialType={"mode" in editing ? editing.type : editing.type}
          onClose={() => setEditing(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.title}"?`}
          body="This can't be undone. Existing bookings that referenced it are kept."
          confirmLabel="Delete"
          busy={deleteMutation.isPending}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

function Group({
  subtitle,
  emptyLabel,
  items,
  renderCard,
}: {
  subtitle: string;
  emptyLabel: string;
  items: Service[];
  renderCard: (s: Service) => React.ReactNode;
}) {
  return (
    <section>
      <p className="text-sm text-muted-foreground mb-4">{subtitle}</p>
      {items.length === 0 ? (
        <div className="card p-6 text-sm text-muted-foreground">{emptyLabel}</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{items.map(renderCard)}</div>
      )}
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 text-sm transition ${
        active
          ? "bg-white text-foreground font-medium shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function ServiceCard({
  service,
  hostSlug,
  onEdit,
  onDelete,
  onToggleActive,
  busy,
}: {
  service: Service;
  hostSlug: string;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: (active: boolean) => void;
  busy?: boolean;
}) {
  const url = `${window.location.origin}/${hostSlug}/${service.slug}`;
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="card p-5 flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold truncate">{service.title}</h3>
            {service.description && (
              <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                {service.description}
              </p>
            )}
          </div>
          {!service.active && (
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-wide px-2 py-0.5 bg-gray-100 text-gray-500">
              Hidden
            </span>
          )}
        </div>

        <div className="flex items-center gap-4 mt-4 text-sm">
          <span className="font-semibold text-lg">
            {service.payWhatYouWant ? "Pay what you want" : formatNaira(service.priceKobo)}
          </span>
          {service.type === "booking" && service.durationMinutes != null && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {formatDuration(service.durationMinutes)}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleCopy}
          className="mt-3 w-full text-left px-3 py-2 bg-gray-50 hover:bg-gray-100 border border-gray-200 flex items-center justify-between gap-2 group"
          title="Copy direct link"
        >
          <span className="text-xs font-mono text-muted-foreground truncate">
            book.me/{hostSlug}/{service.slug}
          </span>
          <span className="shrink-0 inline-flex items-center gap-1 text-xs text-primary">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
      </div>

      <div className="mt-5 pt-4 border-t border-gray-200 flex items-center justify-between">
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={service.active}
            disabled={busy}
            onChange={(e) => onToggleActive(e.target.checked)}
          />
          Active on public page
        </label>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onEdit}
            className="btn-secondary !px-3 !py-1.5 inline-flex items-center gap-1.5"
            aria-label="Edit"
          >
            <Pencil className="w-3.5 h-3.5" />
            <span className="text-xs">Edit</span>
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="btn-secondary !px-3 !py-1.5 inline-flex items-center gap-1.5 !text-red-700 hover:!bg-red-50"
            aria-label="Delete"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="text-xs">Delete</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({
  onNewBooking,
  onNewTip,
}: {
  onNewBooking: () => void;
  onNewTip: () => void;
}) {
  return (
    <div className="card p-10 text-center">
      <h2 className="text-lg font-semibold mb-1">Nothing on your page yet</h2>
      <p className="text-sm text-muted-foreground mb-5">
        Add a bookable service, or a Buy-me-a-coffee-style tip.
      </p>
      <div className="flex items-center justify-center gap-2">
        <button
          type="button"
          onClick={onNewBooking}
          className="btn-primary inline-flex items-center gap-2"
        >
          <CalendarDays className="w-4 h-4" /> Add bookable service
        </button>
        <button
          type="button"
          onClick={onNewTip}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <Coffee className="w-4 h-4" /> Add tip
        </button>
      </div>
    </div>
  );
}

interface FormState {
  type: ServiceType;
  title: string;
  description: string;
  priceNaira: string;
  durationMinutes: string;
  payWhatYouWant: boolean;
  active: boolean;
}

function toFormState(service: Service | null, initialType: ServiceType): FormState {
  if (!service) {
    return {
      type: initialType,
      title: "",
      description: "",
      priceNaira: initialType === "tip" ? "" : "",
      durationMinutes: initialType === "booking" ? "60" : "",
      payWhatYouWant: initialType === "tip",
      active: true,
    };
  }
  return {
    type: service.type,
    title: service.title,
    description: service.description ?? "",
    priceNaira: (service.priceKobo / 100).toString(),
    durationMinutes: service.durationMinutes != null ? String(service.durationMinutes) : "",
    payWhatYouWant: service.payWhatYouWant,
    active: service.active,
  };
}

function ServiceFormModal({
  service,
  initialType,
  onClose,
}: {
  service: Service | null;
  initialType: ServiceType;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toFormState(service, initialType));
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateService();
  const updateMutation = useUpdateService();
  const pending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const handleTypeChange = (type: ServiceType) => {
    setForm({
      ...form,
      type,
      payWhatYouWant: type === "tip" ? true : form.payWhatYouWant,
      priceNaira: type === "tip" ? "" : form.priceNaira,
      durationMinutes: type === "booking" ? form.durationMinutes || "60" : "",
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const title = form.title.trim();
    if (!title) {
      setError("Title is required.");
      return;
    }

    const priceKobo = form.payWhatYouWant ? 0 : Math.round(Number(form.priceNaira) * 100);
    if (!form.payWhatYouWant && (!Number.isFinite(priceKobo) || priceKobo < 0)) {
      setError("Enter a valid price.");
      return;
    }

    const durationMinutes =
      form.type === "tip"
        ? null
        : form.durationMinutes.trim()
          ? Number(form.durationMinutes)
          : null;
    if (durationMinutes != null && (!Number.isInteger(durationMinutes) || durationMinutes <= 0)) {
      setError("Duration must be a positive whole number of minutes.");
      return;
    }

    const description = form.description.trim() || undefined;

    if (service) {
      updateMutation.mutate(
        {
          id: service.id,
          patch: {
            type: form.type,
            title,
            description: description ?? null,
            priceKobo,
            durationMinutes,
            payWhatYouWant: form.payWhatYouWant,
            active: form.active,
          } as Parameters<typeof updateMutation.mutate>[0]["patch"],
        },
        {
          onSuccess: () => {
            toast.success("Saved");
            onClose();
          },
          onError: (err) => setError(readError(err)),
        },
      );
    } else {
      createMutation.mutate(
        {
          type: form.type,
          title,
          description,
          priceKobo,
          durationMinutes: durationMinutes ?? undefined,
          payWhatYouWant: form.payWhatYouWant,
        },
        {
          onSuccess: () => {
            toast.success("Added");
            onClose();
          },
          onError: (err) => setError(readError(err)),
        },
      );
    }
  };

  return (
    <ModalShell onClose={onClose}>
      <form onSubmit={handleSubmit} className="p-6">
        <h2 className="text-xl font-semibold mb-1">
          {service
            ? "Edit"
            : form.type === "tip"
              ? "New tip"
              : "New bookable service"}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {form.type === "tip"
            ? "One-tap payments — customer picks the amount, no calendar."
            : "Customers pick this in the booking wizard with a date + time."}
        </p>

        <div className="space-y-4">
          {!service && (
            <Field label="Type">
              <div className="grid grid-cols-2 gap-2">
                <TypeChoice
                  active={form.type === "booking"}
                  icon={<CalendarDays className="w-4 h-4" />}
                  label="Booking"
                  hint="Date + time"
                  onClick={() => handleTypeChange("booking")}
                />
                <TypeChoice
                  active={form.type === "tip"}
                  icon={<Coffee className="w-4 h-4" />}
                  label="Tip"
                  hint="Buy me a coffee"
                  onClick={() => handleTypeChange("tip")}
                />
              </div>
            </Field>
          )}

          <Field label="Title" required>
            <input
              className="input-field"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={120}
              autoFocus
              required
              placeholder={form.type === "tip" ? "Buy me a coffee" : "1-on-1 Mentorship"}
            />
          </Field>

          <Field label="Description" hint="Shown on the page and the share link.">
            <textarea
              className="input-field min-h-[80px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={500}
              placeholder={
                form.type === "tip"
                  ? "Support my work with a coffee."
                  : "45-min hydrating facial with a warm towel finish."
              }
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field
              label={form.payWhatYouWant ? "Price (locked — pay what you want)" : "Price (₦)"}
              required={!form.payWhatYouWant}
            >
              <div className="flex items-stretch">
                <span className="inline-flex items-center px-3 border border-r-0 border-gray-200 bg-gray-50 text-sm text-muted-foreground select-none">
                  ₦
                </span>
                <input
                  className="input-field flex-1"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.priceNaira}
                  onChange={(e) => setForm({ ...form, priceNaira: e.target.value })}
                  disabled={form.payWhatYouWant}
                  placeholder="12000"
                  required={!form.payWhatYouWant}
                />
              </div>
            </Field>

            {form.type === "booking" && (
              <Field label="Duration (minutes)" hint="Blank if it varies.">
                <input
                  className="input-field"
                  type="number"
                  min={1}
                  max={24 * 60}
                  value={form.durationMinutes}
                  onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                  placeholder="60"
                />
              </Field>
            )}
          </div>

          {form.type === "booking" && (
            <Toggle
              label="Pay what you want"
              hint="Customer picks the amount at checkout."
              value={form.payWhatYouWant}
              onChange={(v) =>
                setForm({ ...form, payWhatYouWant: v, priceNaira: v ? "" : form.priceNaira })
              }
            />
          )}

          {service && (
            <Toggle
              label="Active on public page"
              hint="Uncheck to hide without deleting."
              value={form.active}
              onChange={(v) => setForm({ ...form, active: v })}
            />
          )}

          {error && <FormMessage variant="error" message={error} />}
        </div>

        <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-200">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="btn-secondary"
          >
            Cancel
          </button>
          <button type="submit" disabled={pending} className="btn-primary">
            {pending && <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />}
            {service ? "Save changes" : form.type === "tip" ? "Add tip" : "Add service"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function TypeChoice({
  active,
  icon,
  label,
  hint,
  onClick,
}: {
  active: boolean;
  icon: React.ReactNode;
  label: string;
  hint: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-3 border text-left transition ${
        active ? "border-primary bg-primary-light" : "border-gray-200 hover:bg-gray-50"
      }`}
    >
      <div className={`flex items-center gap-2 text-sm font-medium ${active ? "text-primary" : ""}`}>
        {icon}
        {label}
      </div>
      <div className="text-xs text-muted-foreground mt-1">{hint}</div>
    </button>
  );
}

function ConfirmDialog({
  title,
  body,
  confirmLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  title: string;
  body: string;
  confirmLabel: string;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onCancel();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onCancel]);

  return (
    <ModalShell onClose={onCancel} maxWidth="max-w-md">
      <div className="p-6">
        <h2 className="text-lg font-semibold mb-2">{title}</h2>
        <p className="text-sm text-muted-foreground mb-6">{body}</p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} disabled={busy} className="btn-secondary">
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="btn-primary !bg-red-600 hover:!bg-red-700"
          >
            {busy && <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </ModalShell>
  );
}

function ModalShell({
  children,
  onClose,
  maxWidth = "max-w-xl",
}: {
  children: React.ReactNode;
  onClose: () => void;
  maxWidth?: string;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className={`bg-white w-full ${maxWidth} max-h-[90vh] overflow-y-auto shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  required,
  children,
}: {
  label: string;
  hint?: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className="block text-sm font-medium mb-2">
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1.5">{hint}</p>}
    </div>
  );
}

function Toggle({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted-foreground mt-0.5">{hint}</span>}
      </span>
    </label>
  );
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (m === 0) return `${h} h`;
  return `${h} h ${m} min`;
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
