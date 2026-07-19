import type { Booking } from "@bookmi/shared-types";

/**
 * STUB — Agent 2 fills this in parallel with:
 *   - Bank dropdown via useBanks
 *   - Account number + auto name enquiry via useVerifyBankAccount
 *   - Amount input pre-filled from `booking.amountKobo`, editable
 *   - Optional reason textarea
 *   - Submit via useRefundBooking()
 *
 * The BookingDetailModal imports and renders this when the host clicks
 * "Refund" so the button + wiring in the modal itself doesn't churn.
 */
export function RefundModal({
  booking,
  onClose,
}: {
  booking: Booking;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="bg-white w-full max-w-md p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <h2 className="text-lg font-semibold mb-2">Refund #{booking.code ?? "—"}</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Refund flow lands shortly — bank verify + amount + disbursement.
        </p>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className="btn-secondary">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
