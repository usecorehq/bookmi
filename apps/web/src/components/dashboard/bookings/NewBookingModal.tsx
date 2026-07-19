import { useEffect, useMemo, useState } from "react";
import { Clock, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import type { Service } from "@bookmi/shared-types";
import {
  CustomerSearchOrCreate,
  type CustomerDraft,
} from "@/components/customers/CustomerSearchOrCreate";
import { FormMessage } from "@/components/ui/FormMessage";
import { useHostServices } from "@/hooks/useHostServices";
import { useCreateBooking } from "@/hooks/useUpdateBooking";
import { formatNaira } from "@/lib/utils";

const emptyCustomer: CustomerDraft = {
  customerId: null,
  name: "",
  phone: "",
  email: "",
};

export function NewBookingModal({ onClose }: { onClose: () => void }) {
  const servicesQ = useHostServices();
  const createMutation = useCreateBooking();
  const [customer, setCustomer] = useState<CustomerDraft>(emptyCustomer);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });
  const [time, setTime] = useState<string>("10:00");
  const [durationOverride, setDurationOverride] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const bookableServices = useMemo<Service[]>(
    () =>
      (servicesQ.data ?? []).filter(
        (s) => s.type === "booking" && s.active,
      ),
    [servicesQ.data],
  );

  const chosen = useMemo(
    () => bookableServices.filter((s) => selectedIds.has(s.id)),
    [bookableServices, selectedIds],
  );

  const summedDuration = useMemo(
    () =>
      chosen.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0),
    [chosen],
  );

  const summedAmount = useMemo(
    () => chosen.reduce((sum, s) => sum + s.priceKobo, 0),
    [chosen],
  );

  // Auto-fill the duration override the first time services change, and keep
  // it in sync while the host hasn't manually typed anything different.
  useEffect(() => {
    if (chosen.length === 0) {
      setDurationOverride("");
      return;
    }
    setDurationOverride(String(summedDuration || 60));
  }, [selectedIds, summedDuration, chosen.length]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const toggleService = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!customer.name.trim()) {
      setError("Customer name is required.");
      return;
    }
    if (!customer.phone.trim()) {
      setError("Customer phone is required.");
      return;
    }
    if (chosen.length === 0) {
      setError("Pick at least one service.");
      return;
    }
    if (!date || !time) {
      setError("Pick a date + time.");
      return;
    }
    const duration = Number(durationOverride);
    if (!Number.isInteger(duration) || duration <= 0) {
      setError("Duration must be a positive whole number.");
      return;
    }

    // Combine local date + time into an ISO datetime the API's z.string().datetime()
    // will accept.
    const slot = new Date(`${date}T${time}:00`);
    if (Number.isNaN(slot.getTime())) {
      setError("Bad date or time.");
      return;
    }

    createMutation.mutate(
      {
        serviceIds: chosen.map((s) => s.id),
        durationMinutes: duration,
        customerName: customer.name.trim(),
        customerPhone: customer.phone.trim(),
        customerEmail: customer.email.trim() || undefined,
        customerNotes: notes.trim() || undefined,
        slotStartAt: slot.toISOString(),
      },
      {
        onSuccess: () => {
          toast.success("Booking added");
          onClose();
        },
        onError: (err) => {
          const msg = readError(err);
          setError(msg);
          toast.error(msg);
        },
      },
    );
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-2xl max-h-[92vh] overflow-y-auto shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <form onSubmit={handleSubmit} className="p-6">
          <div className="flex items-start justify-between mb-4">
            <div>
              <h2 className="text-xl font-semibold">New booking</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                Manual entry from the dashboard — customer won't be charged.
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="p-1 text-muted-foreground hover:text-foreground"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-5">
            <Section title="Customer">
              <CustomerSearchOrCreate
                value={customer}
                onChange={setCustomer}
                disabled={createMutation.isPending}
              />
            </Section>

            <Section title="Services" hint="Multi-select — only bookable, active services.">
              {servicesQ.isPending ? (
                <div className="text-sm text-muted-foreground">Loading…</div>
              ) : bookableServices.length === 0 ? (
                <div className="text-sm text-muted-foreground">
                  No active bookable services. Add one on the Services page first.
                </div>
              ) : (
                <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                  {bookableServices.map((s) => {
                    const checked = selectedIds.has(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex items-start gap-3 p-3 border cursor-pointer transition ${
                          checked
                            ? "border-primary bg-primary-light"
                            : "border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          onChange={() => toggleService(s.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium">{s.title}</div>
                          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3">
                            <span>{formatNaira(s.priceKobo)}</span>
                            {s.durationMinutes != null && (
                              <span className="inline-flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {s.durationMinutes} min
                              </span>
                            )}
                          </div>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title="When">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Field label="Date">
                  <input
                    type="date"
                    className="input-field"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Time">
                  <input
                    type="time"
                    className="input-field"
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    required
                  />
                </Field>
                <Field label="Duration (min)">
                  <input
                    type="number"
                    className="input-field"
                    min={1}
                    max={24 * 60}
                    value={durationOverride}
                    onChange={(e) => setDurationOverride(e.target.value)}
                    required
                  />
                </Field>
              </div>
            </Section>

            <Section title="Notes">
              <textarea
                className="input-field min-h-[70px]"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                maxLength={500}
                placeholder="Anything worth remembering for this booking."
              />
            </Section>

            {chosen.length > 0 && (
              <div className="flex items-center justify-between p-3 bg-gray-50 border border-gray-200">
                <div className="text-xs text-muted-foreground">
                  Total (auto-computed by backend)
                </div>
                <div className="text-sm font-semibold">
                  {formatNaira(summedAmount)}
                </div>
              </div>
            )}

            {error && <FormMessage variant="error" message={error} />}
          </div>

          <div className="flex justify-end gap-2 mt-6 pt-4 border-t border-gray-200">
            <button
              type="button"
              onClick={onClose}
              disabled={createMutation.isPending}
              className="btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending}
              className="btn-primary"
            >
              {createMutation.isPending && (
                <Loader2 className="w-4 h-4 mr-2 inline animate-spin" />
              )}
              Add booking
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2">
        <div className="text-sm font-medium">{title}</div>
        {hint && <div className="text-xs text-muted-foreground mt-0.5">{hint}</div>}
      </div>
      {children}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs text-muted-foreground mb-1.5">{label}</label>
      {children}
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
