import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { Booking, Service } from "@bookmi/shared-types";
import { formatNaira } from "@/lib/utils";
import { BookingDetailModal } from "./BookingDetailModal";

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

/**
 * A single booking row on the dashboard list. Clicking anywhere on the row
 * opens the full detail drawer where status transitions + receipt actions
 * live. Modal state is local so we don't need cooperation from parent tabs
 * (the AllBookingsTab + CalendarTab both host this component the same way).
 */
export function BookingRow({
  booking,
  services,
}: {
  booking: Booking;
  services: Service[];
}) {
  const [open, setOpen] = useState(false);

  const serviceTitle = booking.serviceIds
    .map((id) => services.find((s) => s.id === id)?.title)
    .filter(Boolean)
    .join(", ") || "—";

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full text-left py-3 px-1 flex items-center justify-between gap-4 hover:bg-gray-50 border-b border-gray-200 last:border-none"
        aria-label={`Open booking ${booking.code ?? ""} for ${booking.customerName}`}
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
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
      </button>

      {open && (
        <BookingDetailModal
          booking={booking}
          services={services}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
