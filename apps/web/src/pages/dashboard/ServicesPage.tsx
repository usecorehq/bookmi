import { useEffect, useState } from "react";
import { Plus, Pencil, Trash2, Clock, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { FormMessage } from "@/components/ui/FormMessage";
import {
  useCreateService,
  useDeleteService,
  useHostServices,
  useUpdateService,
} from "@/hooks/useHostServices";
import { formatNaira } from "@/lib/utils";
import type { Service } from "@bookmi/shared-types";

export default function ServicesPage() {
  const servicesQ = useHostServices();
  const [editing, setEditing] = useState<Service | "new" | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Service | null>(null);
  const updateMutation = useUpdateService();
  const deleteMutation = useDeleteService();

  const handleToggleActive = (service: Service, active: boolean) => {
    updateMutation.mutate(
      { id: service.id, patch: { active } },
      {
        onSuccess: () => toast.success(active ? "Service activated" : "Service hidden"),
        onError: (err) => toast.error(readError(err)),
      },
    );
  };

  const handleDelete = () => {
    if (!confirmDelete) return;
    deleteMutation.mutate(confirmDelete.id, {
      onSuccess: () => {
        toast.success("Service deleted");
        setConfirmDelete(null);
      },
      onError: (err) => toast.error(readError(err)),
    });
  };

  return (
    <div>
      <PageHeader
        title="Services"
        subtitle="What customers can book on your page."
        actions={
          <button
            type="button"
            onClick={() => setEditing("new")}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> New service
          </button>
        }
      />

      {servicesQ.isPending ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : servicesQ.isError ? (
        <FormMessage variant="error" message="Couldn't load services." />
      ) : servicesQ.data && servicesQ.data.length === 0 ? (
        <EmptyState onCreate={() => setEditing("new")} />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {servicesQ.data?.map((service) => (
            <ServiceCard
              key={service.id}
              service={service}
              onEdit={() => setEditing(service)}
              onDelete={() => setConfirmDelete(service)}
              onToggleActive={(active) => handleToggleActive(service, active)}
              busy={
                (updateMutation.isPending && updateMutation.variables?.id === service.id) ||
                (deleteMutation.isPending && deleteMutation.variables === service.id)
              }
            />
          ))}
        </div>
      )}

      {editing && (
        <ServiceFormModal
          service={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={`Delete "${confirmDelete.title}"?`}
          body="This can't be undone. Existing bookings that referenced this service are kept."
          confirmLabel="Delete"
          busy={deleteMutation.isPending}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={handleDelete}
        />
      )}
    </div>
  );
}

function ServiceCard({
  service,
  onEdit,
  onDelete,
  onToggleActive,
  busy,
}: {
  service: Service;
  onEdit: () => void;
  onDelete: () => void;
  onToggleActive: (active: boolean) => void;
  busy?: boolean;
}) {
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
          {service.durationMinutes != null && (
            <span className="inline-flex items-center gap-1 text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              {formatDuration(service.durationMinutes)}
            </span>
          )}
        </div>
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

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="card p-10 text-center">
      <h2 className="text-lg font-semibold mb-1">No services yet</h2>
      <p className="text-sm text-muted-foreground mb-5">
        Add your first service so customers can book it from your page.
      </p>
      <button
        type="button"
        onClick={onCreate}
        className="btn-primary inline-flex items-center gap-2"
      >
        <Plus className="w-4 h-4" /> Add service
      </button>
    </div>
  );
}

interface FormState {
  title: string;
  description: string;
  priceNaira: string;
  durationMinutes: string;
  payWhatYouWant: boolean;
  active: boolean;
}

function toFormState(service: Service | null): FormState {
  if (!service) {
    return {
      title: "",
      description: "",
      priceNaira: "",
      durationMinutes: "60",
      payWhatYouWant: false,
      active: true,
    };
  }
  return {
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
  onClose,
}: {
  service: Service | null;
  onClose: () => void;
}) {
  const [form, setForm] = useState<FormState>(() => toFormState(service));
  const [error, setError] = useState<string | null>(null);
  const createMutation = useCreateService();
  const updateMutation = useUpdateService();
  const pending = createMutation.isPending || updateMutation.isPending;

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

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

    const durationMinutes = form.durationMinutes.trim()
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
            toast.success("Service updated");
            onClose();
          },
          onError: (err) => setError(readError(err)),
        },
      );
    } else {
      createMutation.mutate(
        {
          title,
          description,
          priceKobo,
          durationMinutes: durationMinutes ?? undefined,
          payWhatYouWant: form.payWhatYouWant,
        },
        {
          onSuccess: () => {
            toast.success("Service added");
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
          {service ? "Edit service" : "New service"}
        </h2>
        <p className="text-sm text-muted-foreground mb-6">
          {service
            ? "Changes are visible on your public page immediately."
            : "Customers see this on your page and in the booking wizard."}
        </p>

        <div className="space-y-4">
          <Field label="Title" required>
            <input
              className="input-field"
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              maxLength={120}
              autoFocus
              required
            />
          </Field>

          <Field label="Description" hint="Shown under the title on your page.">
            <textarea
              className="input-field min-h-[80px]"
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              maxLength={500}
              placeholder="45-min hydrating facial with a warm towel finish."
            />
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Price (₦)" required={!form.payWhatYouWant}>
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

            <Field label="Duration (minutes)" hint="Blank if it varies.">
              <input
                className="input-field"
                type="number"
                min={1}
                max={24 * 60}
                step="5"
                value={form.durationMinutes}
                onChange={(e) => setForm({ ...form, durationMinutes: e.target.value })}
                placeholder="60"
              />
            </Field>
          </div>

          <Toggle
            label="Pay what you want"
            hint="Customer picks the amount at checkout."
            value={form.payWhatYouWant}
            onChange={(v) =>
              setForm({ ...form, payWhatYouWant: v, priceNaira: v ? "" : form.priceNaira })
            }
          />

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
            {service ? "Save changes" : "Add service"}
          </button>
        </div>
      </form>
    </ModalShell>
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
