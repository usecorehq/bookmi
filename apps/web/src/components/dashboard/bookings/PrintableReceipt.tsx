import type { Booking } from "@bookmi/shared-types";
import { formatNaira } from "@/lib/utils";

/**
 * Print-only receipt. Screen-hidden until `window.print()` fires — the
 * `@media print` rules hide the rest of the page and reveal `.print-receipt`.
 * Kept as a plain block (no drawer chrome) so it lays out cleanly on paper.
 */
export function PrintableReceipt({
  booking,
  serviceTitles,
  host,
}: {
  booking: Booking;
  serviceTitles: string;
  host: {
    displayName: string | null;
    phone: string | null;
    address: string | null;
    slug: string | null;
  };
}) {
  const slot = formatSlotFull(booking.slotStartAt);
  return (
    <>
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .print-receipt, .print-receipt * { visibility: visible !important; }
          .print-receipt {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            padding: 32px !important;
            background: white !important;
            color: #111 !important;
            font-family: ui-sans-serif, system-ui, sans-serif !important;
          }
        }
      `}</style>
      <div className="print-receipt hidden print:block">
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 20, fontWeight: 700 }}>
            {host.displayName ?? "Receipt"}
          </div>
          {host.address && (
            <div style={{ fontSize: 12, marginTop: 4 }}>{host.address}</div>
          )}
          {host.phone && (
            <div style={{ fontSize: 12 }}>Tel: {host.phone}</div>
          )}
          {host.slug && (
            <div style={{ fontSize: 12 }}>bookmi.com/{host.slug}</div>
          )}
        </div>

        <hr style={{ margin: "16px 0", border: "none", borderTop: "1px dashed #999" }} />

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span>Booking code</span>
          <span style={{ fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
            #{booking.code ?? booking.id.slice(0, 8)}
          </span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span>Date</span>
          <span>{slot}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span>Duration</span>
          <span>{booking.durationMinutes} min</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span>Status</span>
          <span style={{ textTransform: "uppercase" }}>{booking.status.replace("_", " ")}</span>
        </div>

        <hr style={{ margin: "16px 0", border: "none", borderTop: "1px dashed #999" }} />

        <div style={{ fontSize: 12, marginBottom: 4, textTransform: "uppercase", letterSpacing: 1 }}>
          Customer
        </div>
        <div style={{ fontSize: 14, fontWeight: 600 }}>{booking.customerName}</div>
        {booking.customerEmail && (
          <div style={{ fontSize: 12 }}>{booking.customerEmail}</div>
        )}
        {booking.customerPhone && (
          <div style={{ fontSize: 12 }}>{booking.customerPhone}</div>
        )}

        <hr style={{ margin: "16px 0", border: "none", borderTop: "1px dashed #999" }} />

        <div style={{ fontSize: 12, marginBottom: 8, textTransform: "uppercase", letterSpacing: 1 }}>
          Service
        </div>
        <div style={{ fontSize: 14, marginBottom: 12 }}>{serviceTitles}</div>

        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span>Amount paid</span>
          <span>{formatNaira(booking.amountKobo)}</span>
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, marginBottom: 4 }}>
          <span>Platform fee</span>
          <span>{formatNaira(booking.platformFeeKobo)}</span>
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 14,
            fontWeight: 700,
            borderTop: "1px solid #111",
            paddingTop: 8,
            marginTop: 8,
          }}
        >
          <span>Net to host</span>
          <span>{formatNaira(booking.netToHostKobo)}</span>
        </div>

        <div style={{ textAlign: "center", fontSize: 11, marginTop: 32, color: "#666" }}>
          Thank you for choosing {host.displayName ?? "us"}.
        </div>
      </div>
    </>
  );
}

function formatSlotFull(iso: string | null): string {
  if (!iso) return "N/A";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
