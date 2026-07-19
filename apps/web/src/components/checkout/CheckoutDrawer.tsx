import { useEffect, useMemo, useState } from "react";
import { Loader2, X, Coffee, CalendarDays, Check, Copy } from "lucide-react";
import type { PublicHostView, PublicServiceView } from "@bookmi/shared-types";
import { env } from "@/lib/env";
import { formatNaira } from "@/lib/utils";
import { payWithMonnifyPopup, MonnifyPopupCancelled } from "@/lib/monnifyPopup";

interface CheckoutInitResponse {
  booking: { id: string; code: string | null };
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

/**
 * Anonymous public checkout drawer. Handles both booking + tip flows in one
 * component — the shape of the form + amount handling forks on
 * `service.type`. Renders inline over the public host page.
 */
export function CheckoutDrawer({
  host,
  service,
  onClose,
}: {
  host: PublicHostView;
  service: PublicServiceView;
  onClose: () => void;
}) {
  const isTip = service.type === "tip";
  const isPWYW = isTip || service.payWhatYouWant;
  const floor = service.priceKobo;

  const [step, setStep] = useState<"details" | "success">("details");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Form state
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerNotes, setCustomerNotes] = useState("");
  const [date, setDate] = useState<string>(""); // YYYY-MM-DD
  const [time, setTime] = useState<string>(""); // HH:mm
  const [amountNaira, setAmountNaira] = useState<string>(
    isPWYW ? (floor > 0 ? String(floor / 100) : "") : String(service.priceKobo / 100),
  );

  // Result state
  const [successResult, setSuccessResult] = useState<{
    bookingCode: string | null;
    amountMinor: number;
  } | null>(null);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !processing) onClose();
    };
    document.addEventListener("keydown", onEsc);
    return () => document.removeEventListener("keydown", onEsc);
  }, [onClose, processing]);

  const timeSlots = useMemo(() => {
    if (isTip || !date) return [];
    return generateTimeSlots(host, date, service.durationMinutes ?? 60);
  }, [host, date, service.durationMinutes, isTip]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!customerName.trim()) return setError("Enter your name.");
    if (!customerEmail.trim()) return setError("Enter your email.");
    if (!isTip) {
      if (!date) return setError("Pick a date.");
      if (!time) return setError("Pick a time slot.");
    }
    let amountKobo: number | undefined;
    if (isPWYW) {
      const parsed = Math.round(Number(amountNaira) * 100);
      if (!Number.isFinite(parsed) || parsed <= 0) return setError("Enter an amount.");
      if (parsed < floor)
        return setError(`Amount must be at least ${formatNaira(floor)}.`);
      amountKobo = parsed;
    }

    setProcessing(true);
    try {
      const slotStartAt = !isTip ? new Date(`${date}T${time}:00`).toISOString() : undefined;

      const init = await postCheckout({
        hostSlug: host.slug,
        serviceSlug: service.slug,
        body: {
          customerName: customerName.trim(),
          customerEmail: customerEmail.trim(),
          customerPhone: customerPhone.trim() || undefined,
          customerNotes: customerNotes.trim() || undefined,
          slotStartAt,
          amountKobo,
        },
      });

      const popup = await payWithMonnifyPopup({
        reference: init.payment.reference,
        amount: init.payment.amountMinor / 100,
        currency: init.payment.currency,
        customerName: customerName.trim(),
        customerEmail: customerEmail.trim(),
        paymentDescription: `${host.displayName} · ${service.title}`,
        authorizationUrl: init.payment.authorizationUrl,
      });

      // Verify — idempotent; if the webhook beat us here it'll already
      // read success.
      const verified = await verifyReference(popup.reference);
      if (verified.status !== "success") {
        setError(`Payment status: ${verified.status}. Try again.`);
        setProcessing(false);
        return;
      }

      setSuccessResult({
        bookingCode: init.booking.code,
        amountMinor: verified.amountMinor,
      });
      setStep("success");
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
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/50"
      onClick={processing ? undefined : onClose}
    >
      <div
        className="bg-white w-full max-w-md h-full overflow-y-auto shadow-2xl relative"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button
          type="button"
          onClick={processing ? undefined : onClose}
          disabled={processing}
          className="absolute top-3 right-3 p-2 hover:bg-gray-100 rounded-full disabled:opacity-30"
          aria-label="Close"
        >
          <X className="w-5 h-5" />
        </button>

        {step === "success" && successResult ? (
          <SuccessScreen
            hostSlug={host.slug}
            hostName={host.displayName}
            serviceTitle={service.title}
            isTip={isTip}
            amountMinor={successResult.amountMinor}
            bookingCode={successResult.bookingCode}
            onDone={onClose}
          />
        ) : (
          <form onSubmit={handleSubmit} className="p-6 pt-14 space-y-5">
            <div>
              <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {isTip ? <Coffee className="w-4 h-4" /> : <CalendarDays className="w-4 h-4" />}
                {isTip ? "Send a tip" : "Book an appointment"}
              </div>
              <h2 className="text-2xl font-bold mt-1">{service.title}</h2>
              {service.description && (
                <p className="text-sm text-muted-foreground mt-1">{service.description}</p>
              )}
              <div className="text-sm text-muted-foreground mt-2">
                @{host.slug} · {host.displayName}
              </div>
            </div>

            {!isTip && (
              <div className="grid grid-cols-1 gap-3">
                <Field label="Date">
                  <input
                    type="date"
                    required
                    className="input-field"
                    value={date}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => {
                      setDate(e.target.value);
                      setTime("");
                    }}
                  />
                </Field>
                {date && (
                  <Field label="Time">
                    {timeSlots.length === 0 ? (
                      <div className="text-xs text-red-700">
                        {host.displayName} is closed on this day.
                      </div>
                    ) : (
                      <div className="grid grid-cols-4 gap-2">
                        {timeSlots.map((slot) => (
                          <button
                            key={slot}
                            type="button"
                            onClick={() => setTime(slot)}
                            className={`text-sm py-2 border ${
                              time === slot
                                ? "border-primary bg-primary-light text-primary font-semibold"
                                : "border-gray-200 hover:bg-gray-50"
                            }`}
                          >
                            {slot}
                          </button>
                        ))}
                      </div>
                    )}
                  </Field>
                )}
              </div>
            )}

            <Field label="Your name" required>
              <input
                className="input-field"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                required
                maxLength={120}
              />
            </Field>

            <Field label="Email" required>
              <input
                type="email"
                className="input-field"
                value={customerEmail}
                onChange={(e) => setCustomerEmail(e.target.value)}
                required
                maxLength={200}
              />
            </Field>

            {!isTip && (
              <Field label="Phone" hint="So the host can reach you.">
                <input
                  className="input-field"
                  value={customerPhone}
                  onChange={(e) => setCustomerPhone(e.target.value)}
                  placeholder="+2348012345678"
                  maxLength={40}
                />
              </Field>
            )}

            {!isTip && (
              <Field label="Notes" hint="Anything the host should know.">
                <textarea
                  className="input-field min-h-[70px]"
                  value={customerNotes}
                  onChange={(e) => setCustomerNotes(e.target.value)}
                  maxLength={500}
                />
              </Field>
            )}

            {isPWYW && (
              <Field
                label={isTip ? "Amount" : "Pay what you want (₦)"}
                hint={floor > 0 ? `Minimum ${formatNaira(floor)}.` : undefined}
                required
              >
                <div className="flex items-stretch">
                  <span className="inline-flex items-center px-3 border border-r-0 border-gray-200 bg-gray-50 text-sm text-muted-foreground select-none">
                    ₦
                  </span>
                  <input
                    type="number"
                    className="input-field flex-1"
                    min={floor / 100 || 0.01}
                    step="0.01"
                    value={amountNaira}
                    onChange={(e) => setAmountNaira(e.target.value)}
                    required
                  />
                </div>
              </Field>
            )}

            {error && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 p-3">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={processing}
              className="btn-primary w-full inline-flex items-center justify-center gap-2"
            >
              {processing && <Loader2 className="w-4 h-4 animate-spin" />}
              {isTip
                ? `Send ${amountNaira ? `₦${amountNaira}` : "tip"}`
                : service.payWhatYouWant
                  ? `Pay ${amountNaira ? `₦${amountNaira}` : ""}`
                  : `Pay ${formatNaira(service.priceKobo)}`}
            </button>
            <p className="text-[11px] text-muted-foreground text-center">
              Secure payment powered by Monnify.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

function SuccessScreen({
  hostSlug,
  hostName,
  serviceTitle,
  isTip,
  amountMinor,
  bookingCode,
  onDone,
}: {
  hostSlug: string;
  hostName: string;
  serviceTitle: string;
  isTip: boolean;
  amountMinor: number;
  bookingCode: string | null;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [countdown, setCountdown] = useState(60);

  useEffect(() => {
    if (countdown <= 0) {
      window.location.href = `/${hostSlug}`;
      return;
    }
    const t = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [countdown, hostSlug]);

  const copyCode = async () => {
    if (!bookingCode) return;
    await navigator.clipboard.writeText(bookingCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="p-6 pt-14 flex flex-col items-center text-center">
      <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center mb-4">
        <Check className="w-9 h-9 text-green-700" />
      </div>
      <h2 className="text-2xl font-bold">
        {isTip ? "Thanks for the tip!" : "Booking received!"}
      </h2>
      <p className="text-sm text-muted-foreground mt-2">
        {isTip
          ? `${hostName} will feel the love. ✨`
          : `We'll email you a confirmation. ${hostName} will be in touch shortly.`}
      </p>

      <div className="mt-6 w-full card p-5 bg-gray-50 border border-gray-200">
        <div className="text-xs uppercase tracking-wide text-muted-foreground">
          {serviceTitle}
        </div>
        <div className="text-2xl font-bold mt-1">{formatNaira(amountMinor)}</div>
        {bookingCode && (
          <button
            type="button"
            onClick={copyCode}
            className="mt-4 w-full text-left px-3 py-2 bg-white hover:bg-gray-100 border border-gray-200 flex items-center justify-between"
          >
            <span>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                Booking code
              </div>
              <div className="text-lg font-mono font-semibold">{bookingCode}</div>
            </span>
            <span className="inline-flex items-center gap-1 text-xs text-primary">
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              {copied ? "Copied" : "Copy"}
            </span>
          </button>
        )}
      </div>

      <button
        type="button"
        onClick={onDone}
        className="btn-secondary w-full mt-6"
      >
        Back to {hostName}
      </button>
      <p className="text-[11px] text-muted-foreground mt-3">
        Auto-redirecting in {countdown}s…
      </p>
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
      <label className="block text-sm font-medium mb-1.5">
        {label}
        {required && <span className="text-red-600 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground mt-1">{hint}</p>}
    </div>
  );
}

const DAY_KEYS = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
] as const;

function generateTimeSlots(
  host: PublicHostView,
  date: string,
  durationMinutes: number,
): string[] {
  const day = new Date(`${date}T00:00`).getDay();
  const dayKey = DAY_KEYS[day];
  if (!dayKey) return [];
  const hours = host.operatingHours[dayKey];
  if (!hours || hours.closed) return [];

  const [openH = 0, openM = 0] = hours.open.split(":").map(Number);
  const [closeH = 0, closeM = 0] = hours.close.split(":").map(Number);
  const openMin = openH * 60 + openM;
  const closeMin = closeH * 60 + closeM;
  const step = 30;

  const slots: string[] = [];
  for (let t = openMin; t + durationMinutes <= closeMin; t += step) {
    const h = Math.floor(t / 60);
    const m = t % 60;
    slots.push(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
  }
  return slots;
}

async function postCheckout(input: {
  hostSlug: string;
  serviceSlug: string;
  body: Record<string, unknown>;
}): Promise<CheckoutInitResponse> {
  const res = await fetch(
    `${env.apiUrl}/api/public/${input.hostSlug}/${input.serviceSlug}/checkout`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input.body),
    },
  );
  if (!res.ok) {
    let body: { message?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    throw new Error(body.message || `Checkout failed (${res.status})`);
  }
  return res.json();
}

async function verifyReference(reference: string): Promise<VerifyResponse> {
  const res = await fetch(
    `${env.apiUrl}/api/public/checkout/${encodeURIComponent(reference)}/verify`,
    { headers: { "Content-Type": "application/json" } },
  );
  if (!res.ok) {
    let body: { message?: string } = {};
    try {
      body = await res.json();
    } catch {
      /* ignore */
    }
    throw new Error(body.message || `Verify failed (${res.status})`);
  }
  return res.json();
}
