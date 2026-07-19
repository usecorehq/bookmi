import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Check, ArrowRight, ShieldCheck } from "lucide-react";
import type { PublicHostView, PublicServiceView } from "@bookmi/shared-types";
import { env } from "@/lib/env";
import { formatNaira } from "@/lib/utils";
import { payWithMonnifyPopup, MonnifyPopupCancelled } from "@/lib/monnifyPopup";

/**
 * Public payment surface — `/pay/:bookingId`.
 *
 * Landing page for the email link a host sends via
 * `POST /hosts/me/bookings/:id/send-payment-link`. Reads the pending booking
 * from `GET /api/public/bookings/:id`, shows the summary, and opens the
 * Monnify popup against `POST /api/public/bookings/:id/resume-checkout` —
 * which reuses the existing booking id as `purposeId` so a successful
 * payment flips THAT booking to confirmed (no new booking is created).
 *
 * Anonymous: no auth token attached to any request. The booking id in the
 * URL is the capability, and the API returns 410 Gone once the booking is
 * no longer pending — a stale link can't accidentally re-open a paid booking.
 */

interface PublicBookingResponse {
  booking: {
    id: string;
    code: string | null;
    status:
      | "pending"
      | "confirmed"
      | "canceled"
      | "failed"
      | "arrived"
      | "seated"
      | "completed"
      | "no_show";
    customerName: string;
    customerEmail: string;
    amountKobo: number;
    slotStartAt: string | null;
    durationMinutes: number;
  };
  host: PublicHostView;
  service: PublicServiceView;
}

interface ResumeCheckoutResponse {
  payment: {
    reference: string;
    provider: string;
    amountMinor: number;
    currency: string;
    status: string;
    accessCode?: string;
    authorizationUrl?: string;
  };
}

interface VerifyResponse {
  reference: string;
  status: string;
  amountMinor: number;
  currency: string;
  provider: string;
  completedAt: string | null;
}

/** Bare fetch — public routes accept no token. Errors carry the HTTP status. */
async function publicFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${env.apiUrl}/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = await res.text();
    }
    const message =
      (typeof body === "object" && body && "message" in body && String(body.message)) ||
      `API ${res.status} on ${path}`;
    const err = new Error(message) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json() as Promise<T>;
}

export default function BookingPaymentPage() {
  const { bookingId } = useParams<{ bookingId: string }>();

  const query = useQuery<PublicBookingResponse, Error & { status?: number }>({
    queryKey: ["payment-link", bookingId],
    enabled: !!bookingId,
    queryFn: () => publicFetch<PublicBookingResponse>(`/public/bookings/${bookingId}`),
    retry: (failureCount, error) => {
      // 404 / 410 are terminal — no point retrying a dead link.
      const status = error.status;
      if (status === 404 || status === 410) return false;
      return failureCount < 2;
    },
  });

  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{
    amountMinor: number;
    bookingCode: string | null;
  } | null>(null);

  if (!bookingId) {
    return (
      <PageShell>
        <InvalidCard fallbackSlug={null} />
      </PageShell>
    );
  }

  if (query.isPending) {
    return (
      <PageShell>
        <div className="bg-white border border-gray-200 shadow-sm p-8 flex items-center justify-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="w-4 h-4 animate-spin" />
          Loading booking…
        </div>
      </PageShell>
    );
  }

  // 404: link points at a booking that doesn't exist.
  // 410: booking has already been paid, canceled, or otherwise moved on.
  const status = query.error?.status;
  if (query.isError && (status === 404 || status === 410)) {
    return (
      <PageShell>
        <InvalidCard fallbackSlug={null} />
      </PageShell>
    );
  }
  if (query.isError || !query.data) {
    return (
      <PageShell>
        <InvalidCard fallbackSlug={null} />
      </PageShell>
    );
  }

  const { booking, host, service } = query.data;

  if (success) {
    return (
      <PageShell>
        <PaidCard
          host={host}
          service={service}
          amountMinor={success.amountMinor}
          bookingCode={success.bookingCode}
        />
      </PageShell>
    );
  }

  const handlePay = async () => {
    setError(null);
    setProcessing(true);
    try {
      const init = await publicFetch<ResumeCheckoutResponse>(
        `/public/bookings/${booking.id}/resume-checkout`,
        { method: "POST", body: JSON.stringify({}) },
      );

      const popup = await payWithMonnifyPopup({
        reference: init.payment.reference,
        amount: init.payment.amountMinor / 100,
        currency: init.payment.currency,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        paymentDescription: `${host.displayName} · ${service.title}`,
        authorizationUrl: init.payment.authorizationUrl,
      });

      // The webhook may have already flipped the booking to success, but we
      // verify explicitly so the UI can react. `verify` is idempotent.
      const verified = await publicFetch<VerifyResponse>(
        `/public/checkout/${encodeURIComponent(popup.reference)}/verify`,
      );

      if (verified.status !== "success") {
        setError(`Payment status: ${verified.status}. Try again.`);
        setProcessing(false);
        return;
      }

      setSuccess({
        amountMinor: verified.amountMinor,
        bookingCode: booking.code,
      });
    } catch (err) {
      if (err instanceof MonnifyPopupCancelled) {
        setError("Payment cancelled — you can try again.");
      } else {
        setError(err instanceof Error ? err.message : "Something went wrong.");
      }
    } finally {
      setProcessing(false);
    }
  };

  return (
    <PageShell>
      <div className="bg-white border border-gray-200 shadow-sm p-6 sm:p-8">
        <div className="text-xs font-semibold text-primary uppercase tracking-wide mb-1">
          Complete your booking
        </div>
        <h1 className="text-2xl font-bold leading-tight">{service.title}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          with <span className="font-medium">{host.displayName}</span>
          {host.slug ? ` · @${host.slug}` : ""}
        </p>

        <div className="mt-6 bg-gray-50 border border-gray-200 p-5">
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Amount due
          </div>
          <div className="text-3xl font-bold mt-1">
            {formatNaira(booking.amountKobo)}
          </div>
        </div>

        <dl className="mt-5 grid grid-cols-1 gap-2 text-sm">
          <SummaryRow label="Booked by" value={booking.customerName} />
          {booking.slotStartAt && (
            <SummaryRow label="When" value={formatDate(booking.slotStartAt)} />
          )}
          {booking.code && (
            <SummaryRow
              label="Booking code"
              value={<span className="font-mono">{booking.code}</span>}
            />
          )}
        </dl>

        {error && (
          <div className="mt-5 text-sm text-red-700 bg-red-50 border border-red-200 p-3">
            {error}
          </div>
        )}

        <button
          type="button"
          onClick={handlePay}
          disabled={processing}
          className="btn-primary w-full mt-6 inline-flex items-center justify-center gap-2"
        >
          {processing ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <ShieldCheck className="w-4 h-4" />
          )}
          Pay {formatNaira(booking.amountKobo)}
        </button>
        <p className="text-[11px] text-muted-foreground text-center mt-3">
          Secure payment powered by Monnify.
        </p>
      </div>

      <p className="text-xs text-muted-foreground text-center mt-6">
        Powered by Bookmi · Qorelly
      </p>
    </PageShell>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">{children}</div>
    </div>
  );
}

function SummaryRow({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-muted-foreground uppercase tracking-wide">
        {label}
      </dt>
      <dd className="text-sm font-medium text-right">{value}</dd>
    </div>
  );
}

function InvalidCard({ fallbackSlug }: { fallbackSlug: string | null }) {
  const href = fallbackSlug ? `/${fallbackSlug}` : "/";
  return (
    <div className="bg-white border border-gray-200 shadow-sm p-8 text-center">
      <h1 className="text-xl font-semibold">Link no longer valid</h1>
      <p className="text-sm text-muted-foreground mt-2">
        This payment link is no longer valid. It may have already been used, or
        the booking was canceled.
      </p>
      <a
        href={href}
        className="btn-secondary mt-6 inline-flex items-center justify-center gap-1"
      >
        Go home
        <ArrowRight className="w-4 h-4" />
      </a>
    </div>
  );
}

/**
 * Steal-the-shape-not-the-code from CheckoutDrawer's SuccessScreen — the
 * payment page has a different chrome (no drawer, no close button) so a
 * bespoke card reads better than trying to reuse the drawer variant.
 */
function PaidCard({
  host,
  service,
  amountMinor,
  bookingCode,
}: {
  host: PublicHostView;
  service: PublicServiceView;
  amountMinor: number;
  bookingCode: string | null;
}) {
  const [countdown, setCountdown] = useState(10);

  useEffect(() => {
    if (countdown <= 0) {
      window.location.href = `/${host.slug}`;
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, host.slug]);

  return (
    <div className="bg-white border border-gray-200 shadow-sm p-8 text-center">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mx-auto mb-4">
        <Check className="w-9 h-9 text-green-700" />
      </div>
      <h1 className="text-2xl font-bold">Payment received!</h1>
      <p className="text-sm text-muted-foreground mt-2">
        Your booking with {host.displayName} is confirmed. A receipt is on its
        way to your inbox.
      </p>

      <div className="mt-6 bg-gray-50 border border-gray-200 p-5 text-left">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {service.title}
        </div>
        <div className="text-2xl font-bold mt-1">{formatNaira(amountMinor)}</div>
        {bookingCode && (
          <div className="mt-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
              Booking code
            </div>
            <div className="text-lg font-mono font-semibold">{bookingCode}</div>
          </div>
        )}
      </div>

      <a
        href={`/${host.slug}`}
        className="btn-secondary w-full mt-6 inline-flex items-center justify-center"
      >
        Back to {host.displayName}
      </a>
      <p className="text-[11px] text-muted-foreground mt-3">
        Auto-redirecting in {countdown}s…
      </p>
    </div>
  );
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-NG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
