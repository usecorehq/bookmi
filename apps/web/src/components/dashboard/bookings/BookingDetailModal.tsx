import { useEffect, useState } from "react";
import {
  Loader2,
  X,
  Phone,
  Mail,
  Calendar,
  Clock,
  Send,
  Undo2,
} from "lucide-react";
import { toast } from "sonner";
import type { Booking, BookingStatus, Service } from "@bookmi/shared-types";
import { formatNaira } from "@/lib/utils";
import { useUpdateBooking } from "@/hooks/useUpdateBooking";
import { useSendPaymentLink } from "@/hooks/useBookingActions";
import { useHostServices } from "@/hooks/useHostServices";
import { useAuth } from "@/contexts/AuthContext";
import { RefundModal } from "./RefundModal";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-amber-50 text-amber-700",
  confirmed: "bg-primary-light text-primary",
  arrived: "bg-blue-50 text-blue-700",
  seated: "bg-blue-50 text-blue-700",
  completed: "bg-green-50 text-green-700",
  canceled: "bg-gray-100 text-gray-500",
  failed: "bg-red-50 text-red-700",
  no_show: "bg-gray-100 text-gray-500",
};

/**
 * Actions offered per current status. Backend still enforces the graph — the
 * UI just narrows the set to what makes sense to click.
 */
const STATUS_TRANSITIONS: Record<string, { status: BookingStatus; label: string; destructive?: boolean }[]> = {
  pending: [
    { status: "canceled", label: "Cancel", destructive: true },
  ],
  confirmed: [
    { status: "arrived", label: "Mark arrived" },
    { status: "no_show", label: "Mark no-show" },
    { status: "canceled", label: "Cancel", destructive: true },
  ],
  arrived: [
    { status: "seated", label: "Mark seated" },
    { status: "canceled", label: "Cancel", destructive: true },
  ],
  seated: [
    { status: "completed", label: "Mark completed" },
  ],
  completed: [],
  canceled: [],
  failed: [],
  no_show: [],
};

export function BookingDetailModal({
  booking,
  services,
  onClose,
  onUpdated,
}: {
  booking: Booking;
  services: Service[];
  onClose: () => void;
  onUpdated?: () => void;
}) {
  const updateMutation = useUpdateBooking();
  const sendPaymentLinkMutation = useSendPaymentLink();
  const servicesQ = useHostServices();
  const { profile } = useAuth();
  const [refundOpen, setRefundOpen] = useState(false);

  // Prefer the explicitly-passed list; fall back to the query cache. Lets the
  // modal work regardless of whether the parent already resolved services.
  const resolvedServices = services.length > 0 ? services : (servicesQ.data ?? []);

  const bookingServices = booking.serviceIds
    .map((id) => resolvedServices.find((s) => s.id === id))
    .filter(Boolean) as Service[];

  const serviceTitles = bookingServices.length > 0
    ? bookingServices.map((s) => s.title).join(" · ")
    : "—";

  const firstServiceSlug = bookingServices[0]?.slug ?? null;

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose]);

  const handleTransition = (status: BookingStatus) => {
    updateMutation.mutate(
      { id: booking.id, patch: { status } },
      {
        onSuccess: () => {
          toast.success(`Marked ${status.replace("_", " ")}`);
          onUpdated?.();
        },
        onError: (err) => toast.error(readError(err)),
      },
    );
  };

  // firstServiceSlug + hostSlug were used by the old mailto payment-link
  // implementation. They're no longer read but kept as computed so future
  // deep-links (e.g. copy-to-clipboard) can reuse them.
  void firstServiceSlug;

  const handleSendPaymentLink = () => {
    if (!booking.customerEmail) {
      toast.error("No customer email on file.");
      return;
    }
    sendPaymentLinkMutation.mutate(booking.id, {
      onSuccess: (r) => toast.success(`Payment link emailed to ${r.email}`),
      onError: (err) => toast.error(readError(err)),
    });
  };

  const transitions = STATUS_TRANSITIONS[booking.status] ?? [];
  const canSendPaymentLink = booking.status === "pending";
  // Refund is only meaningful once money has landed and hasn't been unwound.
  const canRefund =
    booking.status === "confirmed" ||
    booking.status === "arrived" ||
    booking.status === "seated" ||
    booking.status === "completed";

  const created = new Date(booking.createdAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50 print:hidden"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-[450px] h-full overflow-y-auto shadow-2xl relative flex flex-col"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Booking detail"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-3 right-3 p-2 hover:bg-gray-100 rounded-full z-10"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex-1 overflow-y-auto">
          {/* Header */}
          <div className="p-6 pt-14 border-b border-gray-200">
            <div className="text-xs font-mono text-muted-foreground">
              #{booking.code ?? booking.id.slice(0, 8)}
            </div>
            <h2 className="text-xl font-bold mt-1 leading-tight">
              {serviceTitles}
            </h2>
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              <StatusPill status={booking.status} />
              <SourcePill source={booking.source} />
            </div>
            <div className="text-xs text-muted-foreground mt-3">
              Created: {created}
            </div>
          </div>

          {/* Customer */}
          <Section title="Customer">
            <div className="font-semibold text-base">{booking.customerName}</div>
            <div className="mt-2 space-y-1.5">
              {booking.customerPhone && (
                <a
                  href={`tel:${booking.customerPhone}`}
                  className="flex items-center gap-2 text-sm text-primary hover:underline"
                >
                  <Phone className="w-4 h-4" />
                  {booking.customerPhone}
                </a>
              )}
              {booking.customerEmail && (
                <a
                  href={`mailto:${booking.customerEmail}`}
                  className="flex items-center gap-2 text-sm text-primary hover:underline break-all"
                >
                  <Mail className="w-4 h-4 shrink-0" />
                  {booking.customerEmail}
                </a>
              )}
            </div>
            {booking.customerNotes && (
              <div className="mt-3 p-3 bg-gray-50 border border-gray-200 text-sm">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                  Notes
                </div>
                <div className="whitespace-pre-wrap">{booking.customerNotes}</div>
              </div>
            )}
          </Section>

          {/* Schedule */}
          <Section title="Schedule">
            <div className="flex items-center gap-2 text-sm">
              <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
              <span>{formatSlotFull(booking.slotStartAt)}</span>
            </div>
            <div className="flex items-center gap-2 text-sm mt-1.5">
              <Clock className="w-4 h-4 text-muted-foreground shrink-0" />
              <span>{booking.durationMinutes} min</span>
            </div>
          </Section>

          {/* Payment */}
          <Section title="Payment">
            <Row label="Amount paid" value={formatNaira(booking.amountKobo)} />
            <Row label="Platform fee" value={formatNaira(booking.platformFeeKobo)} />
            <Row
              label="Net to host"
              value={formatNaira(booking.netToHostKobo)}
              emphasis
            />
          </Section>
        </div>

        {/* Actions footer */}
        {(transitions.length > 0 || canSendPaymentLink || canRefund) && (
          <div className="border-t border-gray-200 p-4 bg-gray-50 space-y-2">
            {transitions.map((t) => {
              const isMutating =
                updateMutation.isPending &&
                updateMutation.variables?.patch.status === t.status;
              return (
                <button
                  key={t.status}
                  type="button"
                  disabled={updateMutation.isPending}
                  onClick={() => handleTransition(t.status)}
                  className={
                    t.destructive
                      ? "btn-secondary w-full !text-red-700 hover:!bg-red-50"
                      : "btn-primary w-full"
                  }
                >
                  {isMutating && <Loader2 className="w-4 h-4 animate-spin" />}
                  {t.label}
                </button>
              );
            })}

            {canSendPaymentLink && (
              <button
                type="button"
                onClick={handleSendPaymentLink}
                disabled={sendPaymentLinkMutation.isPending}
                className="btn-secondary w-full"
              >
                {sendPaymentLinkMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Send className="w-4 h-4" />
                )}
                Send payment link
              </button>
            )}

            {canRefund && (
              <button
                type="button"
                onClick={() => setRefundOpen(true)}
                className="btn-secondary w-full !text-red-700 hover:!bg-red-50"
              >
                <Undo2 className="w-4 h-4" />
                Refund
              </button>
            )}
          </div>
        )}
      </div>

      {refundOpen && (
        <RefundModal
          booking={booking}
          onClose={() => setRefundOpen(false)}
        />
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="p-6 border-b border-gray-200">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-2 font-semibold">
        {title}
      </div>
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  emphasis,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-1.5 ${
        emphasis
          ? "border-t border-gray-200 mt-1.5 pt-3 text-base font-semibold"
          : "text-sm"
      }`}
    >
      <span className={emphasis ? "" : "text-muted-foreground"}>{label}</span>
      <span>{value}</span>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const label = status.replace("_", " ");
  const cls = STATUS_STYLE[status] ?? "bg-gray-100 text-gray-700";
  return (
    <span
      className={`inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${cls}`}
    >
      {label}
    </span>
  );
}

function SourcePill({ source }: { source: string }) {
  const label = SOURCE_LABEL[source] ?? source;
  return (
    <span className="inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-gray-100 text-gray-600">
      {label}
    </span>
  );
}

/**
 * DB stores `storefront` as the legacy source key. Renaming the column is a
 * migration; renaming just the surfaced label is one map.
 */
const SOURCE_LABEL: Record<string, string> = {
  storefront: "Public",
  dashboard: "Dashboard",
};

function formatSlotFull(iso: string | null): string {
  if (!iso) return "No slot (tip)";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
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

