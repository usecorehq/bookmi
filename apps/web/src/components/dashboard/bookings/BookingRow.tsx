import { useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { Booking, BookingStatus, Service } from "@bookmi/shared-types";
import { formatNaira } from "@/lib/utils";
import { useUpdateBooking } from "@/hooks/useUpdateBooking";

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
 * The host-side transition graph the UI offers. The backend enforces the
 * same shape — we just show the buttons; a bad click surfaces a toast.
 */
const NEXT_STATUSES: Record<string, BookingStatus[]> = {
  pending: ["canceled"],
  confirmed: ["arrived", "canceled", "no_show", "completed"],
  arrived: ["seated", "completed", "canceled", "no_show"],
  seated: ["completed", "canceled"],
  completed: [],
  canceled: [],
  failed: [],
  no_show: [],
};

const STATUS_LABEL: Record<BookingStatus, string> = {
  pending: "Mark pending",
  confirmed: "Confirm",
  arrived: "Mark arrived",
  seated: "Mark seated",
  completed: "Mark completed",
  canceled: "Cancel",
  failed: "Mark failed",
  no_show: "Mark no-show",
};

const DESTRUCTIVE: Set<BookingStatus> = new Set(["canceled", "no_show", "failed"]);

export function StatusPill({ status }: { status: string }) {
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

export function formatSlot(iso: string | null): string {
  if (!iso) return "No slot";
  const d = new Date(iso);
  const date = d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  const time = d.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${date} · ${time}`;
}

export function BookingRow({
  booking,
  services,
  defaultExpanded,
}: {
  booking: Booking;
  services: Service[];
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(!!defaultExpanded);
  const updateMutation = useUpdateBooking();

  const serviceTitle = booking.serviceIds
    .map((id) => services.find((s) => s.id === id)?.title)
    .filter(Boolean)
    .join(", ") || "—";

  const nextStatuses = NEXT_STATUSES[booking.status] ?? [];

  const handleTransition = (status: BookingStatus) => {
    updateMutation.mutate(
      { id: booking.id, patch: { status } },
      {
        onSuccess: () => toast.success(`Marked ${status.replace("_", " ")}`),
        onError: (err) => toast.error(readError(err)),
      },
    );
  };

  return (
    <div className="border-b border-gray-200 last:border-none">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full text-left py-3 px-1 flex items-start justify-between gap-4 hover:bg-gray-50"
        aria-expanded={expanded}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-0.5">
            {booking.code && (
              <span className="text-[11px] font-mono text-muted-foreground">
                #{booking.code}
              </span>
            )}
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              {booking.source}
            </span>
          </div>
          <div className="font-medium truncate">{booking.customerName}</div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">
            {serviceTitle} · {formatSlot(booking.slotStartAt)}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-sm font-medium">{formatNaira(booking.amountKobo)}</div>
          <div className="mt-1">
            <StatusPill status={booking.status} />
          </div>
        </div>
      </button>

      {expanded && (
        <div className="px-1 pb-4 pt-1 space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs">
            <Detail label="Phone" value={booking.customerPhone || "—"} />
            <Detail label="Email" value={booking.customerEmail || "—"} />
            <Detail
              label="Duration"
              value={`${booking.durationMinutes} min`}
            />
            <Detail
              label="Created"
              value={new Date(booking.createdAt).toLocaleString()}
            />
            {booking.customerNotes && (
              <div className="sm:col-span-2">
                <Detail label="Notes" value={booking.customerNotes} />
              </div>
            )}
          </div>

          {nextStatuses.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-100">
              <span className="text-xs text-muted-foreground">Move to:</span>
              {nextStatuses.map((s) => (
                <button
                  key={s}
                  type="button"
                  disabled={updateMutation.isPending}
                  onClick={() => handleTransition(s)}
                  className={`text-xs px-2.5 py-1 border transition ${
                    DESTRUCTIVE.has(s)
                      ? "border-red-200 text-red-700 hover:bg-red-50"
                      : "border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {updateMutation.isPending &&
                    updateMutation.variables?.patch.status === s && (
                      <Loader2 className="w-3 h-3 mr-1 inline animate-spin" />
                    )}
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="text-muted-foreground shrink-0 w-16">{label}</span>
      <span className="truncate">{value}</span>
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
