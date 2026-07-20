import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Coffee, Search } from "lucide-react";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { useDebounce } from "@/hooks/useDebounce";
import { useHostBookings } from "@/hooks/useHostBookings";
import { useHostServices } from "@/hooks/useHostServices";
import { formatNaira } from "@/lib/utils";
import type { Booking, Service } from "@bookmi/shared-types";

/**
 * One-tap payments — Buy Me a Coffee-style tips. These live in the same
 * `bookings` table as real bookings but have `slot_start_at IS NULL`
 * (PublicCheckoutService never sets a slot on a tip). This page filters to
 * them via `kind: 'tip'` so the Bookings page stays focused on scheduled
 * appointments and this one owns the tip inbox.
 */
export default function TipsPage() {
  const [q, setQ] = useState("");
  const debouncedQ = useDebounce(q, 250);
  const servicesQ = useHostServices();
  const tipsQ = useHostBookings({
    kind: "tip",
    q: debouncedQ.trim() || undefined,
    limit: 100,
  });

  const services = servicesQ.data ?? [];
  const tips = tipsQ.data ?? [];
  const totalKobo = useMemo(
    () => tips.reduce((sum, t) => sum + t.amountKobo, 0),
    [tips],
  );

  return (
    <div>
      <PageHeader
        title="Tips"
        subtitle="Every Buy Me a Coffee-style payment lands here."
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <SummaryCard label="Tips received" value={String(tips.length)} />
        <SummaryCard label="Total collected" value={formatNaira(totalKobo)} />
        <SummaryCard
          label="Average tip"
          value={tips.length ? formatNaira(Math.round(totalKobo / tips.length)) : "—"}
        />
      </div>

      <div className="card p-4 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            className="input-field pl-10"
            placeholder="Search name, phone, or email…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="card p-4">
        {tipsQ.isPending ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : tipsQ.isError ? (
          <div className="text-sm text-red-700">Couldn't load tips. Try again in a moment.</div>
        ) : tips.length === 0 ? (
          <EmptyState />
        ) : (
          <ul className="divide-y divide-gray-200">
            {tips.map((tip) => (
              <TipRow key={tip.id} tip={tip} services={services} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        <Coffee className="w-5 h-5" />
        <span className="text-xs font-medium uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
    </div>
  );
}

function TipRow({ tip, services }: { tip: Booking; services: Service[] }) {
  const navigate = useNavigate();
  const serviceMap = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );
  const titles = tip.serviceIds
    .map((id) => serviceMap.get(id)?.title ?? "—")
    .join(" · ");

  // Every checkout resolves-or-creates a customer, so customerId is nearly
  // always set. Legacy rows without one stay visible but non-clickable —
  // there's no destination to send the host to. The field lives on the DB
  // row and rides through the API but isn't in the shared Booking type yet,
  // so we read it via a narrow cast.
  const customerId = (tip as { customerId?: string | null }).customerId ?? null;
  const clickable = customerId != null;
  const goToCustomer = () => {
    if (customerId) navigate(`/dashboard/customers/${customerId}`);
  };

  const inner = (
    <>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          {tip.code && (
            <span className="font-mono text-[11px] bg-gray-100 px-1.5 py-0.5">
              #{tip.code}
            </span>
          )}
          <span className="font-semibold truncate">{tip.customerName}</span>
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-amber-50 text-amber-800">
            <Coffee className="w-3 h-3" />
            Tip
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-1 truncate">
          {titles || "Tip"} · {new Date(tip.createdAt).toLocaleString()}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="text-sm font-semibold">{formatNaira(tip.amountKobo)}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground mt-0.5">
          Received
        </div>
      </div>
    </>
  );

  return (
    <li>
      {clickable ? (
        <button
          type="button"
          onClick={goToCustomer}
          className="w-full py-4 flex items-center justify-between gap-4 text-left hover:bg-gray-50 -mx-2 px-2 transition cursor-pointer"
        >
          {inner}
        </button>
      ) : (
        <div className="py-4 flex items-center justify-between gap-4">
          {inner}
        </div>
      )}
    </li>
  );
}

function EmptyState() {
  return (
    <div className="p-8 text-center">
      <div className="w-12 h-12 mx-auto bg-primary-light text-primary flex items-center justify-center mb-3">
        <Coffee className="w-6 h-6" />
      </div>
      <h3 className="text-lg font-semibold mb-1">No tips yet</h3>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        When someone pays via one of your tip links, it lands here — separate from your
        scheduled bookings.
      </p>
    </div>
  );
}
