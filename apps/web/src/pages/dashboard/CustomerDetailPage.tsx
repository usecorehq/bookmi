import { useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  ArrowLeft,
  CalendarDays,
  Coffee,
  Mail,
  Phone,
  TrendingUp,
  Users,
} from "lucide-react";
import type { Booking, Customer, Service } from "@bookmi/shared-types";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { BookingDetailModal } from "@/components/dashboard/bookings/BookingDetailModal";
import { useCustomer, useCustomerBookings } from "@/hooks/useCustomers";
import { useHostServices } from "@/hooks/useHostServices";
import { Skeleton } from "@/components/ui/Skeleton";
import { formatNaira } from "@/lib/utils";

type Tab = "bookings" | "tips";

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const customerQ = useCustomer(id);
  const bookingsQ = useCustomerBookings(id);
  const servicesQ = useHostServices();

  return (
    <div>
      <Link
        to="/dashboard/customers"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-primary mb-4"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to customers
      </Link>

      {customerQ.isPending ? (
        <CustomerDetailSkeleton />
      ) : customerQ.isError ? (
        <ErrorState notFound={isNotFound(customerQ.error)} />
      ) : !customerQ.data ? (
        <ErrorState notFound />
      ) : (
        <Loaded
          customer={customerQ.data}
          bookings={bookingsQ.data ?? []}
          bookingsPending={bookingsQ.isPending}
          services={servicesQ.data ?? []}
        />
      )}
    </div>
  );
}

function Loaded({
  customer,
  bookings,
  bookingsPending,
  services,
}: {
  customer: Customer;
  bookings: Booking[];
  bookingsPending: boolean;
  services: Service[];
}) {
  const serviceMap = useMemo(
    () => new Map(services.map((s) => [s.id, s])),
    [services],
  );
  const [tab, setTab] = useState<Tab>("bookings");
  const [selected, setSelected] = useState<Booking | null>(null);

  const bookingRows = useMemo(
    () => bookings.filter((b) => b.slotStartAt),
    [bookings],
  );
  const tipRows = useMemo(
    () => bookings.filter((b) => !b.slotStartAt),
    [bookings],
  );

  return (
    <>
      <PageHeader
        title={customer.name}
        subtitle="Contact info and booking history."
      />

      {/* Header card — avatar + contact + notes */}
      <div className="card p-6 mb-6">
        <div className="flex items-start gap-4 flex-wrap">
          <div className="w-16 h-16 shrink-0 bg-gray-100 text-gray-700 flex items-center justify-center font-semibold text-xl">
            {initials(customer.name)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-lg font-semibold">{customer.name}</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1 text-sm text-muted-foreground">
              {customer.phone && (
                <a
                  href={`tel:${customer.phone}`}
                  className="inline-flex items-center gap-1.5 hover:text-primary"
                >
                  <Phone className="w-3.5 h-3.5" />
                  {customer.phone}
                </a>
              )}
              {customer.email && (
                <a
                  href={`mailto:${customer.email}`}
                  className="inline-flex items-center gap-1.5 hover:text-primary"
                >
                  <Mail className="w-3.5 h-3.5" />
                  {customer.email}
                </a>
              )}
              {!customer.phone && !customer.email && (
                <span className="italic">No contact info</span>
              )}
            </div>
          </div>
        </div>

        {customer.notes && (
          <div className="mt-4 pt-4 border-t border-gray-200">
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground mb-1">
              Notes
            </div>
            <p className="text-sm whitespace-pre-wrap">{customer.notes}</p>
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <StatCard
          icon={<Users className="w-5 h-5" />}
          label="Total bookings"
          value={String(customer.totalBookings)}
        />
        <StatCard
          icon={<TrendingUp className="w-5 h-5" />}
          label="Total spent"
          value={formatNaira(customer.totalSpentKobo)}
        />
        <StatCard
          icon={<CalendarDays className="w-5 h-5" />}
          label="Last visit"
          value={humanizeRelative(customer.lastBookingAt)}
          hint={customer.lastBookingAt ? formatDate(customer.lastBookingAt) : undefined}
        />
      </div>

      {/* Segmented pill tabs — mirror BookingsPage so scheduled appointments
          stay visually distinct from Buy-Me-a-Coffee-style tips. */}
      <div className="mb-5 inline-flex bg-gray-100 p-1">
        <TabButton active={tab === "bookings"} onClick={() => setTab("bookings")}>
          <CalendarDays className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          Bookings · {bookingRows.length}
        </TabButton>
        <TabButton active={tab === "tips"} onClick={() => setTab("tips")}>
          <Coffee className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          Tips · {tipRows.length}
        </TabButton>
      </div>

      {tab === "bookings" ? (
        <HistorySection
          emptyLabel="No bookings recorded yet."
          pending={bookingsPending}
          rows={bookingRows}
          serviceMap={serviceMap}
          onRowClick={(b) => setSelected(b)}
        />
      ) : (
        <HistorySection
          emptyLabel="No tips received yet."
          pending={bookingsPending}
          rows={tipRows}
          serviceMap={serviceMap}
          isTipSection
        />
      )}

      {selected && (
        <BookingDetailModal
          booking={selected}
          services={services}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-1.5 text-sm transition ${
        active
          ? "bg-white text-foreground font-medium shadow-sm"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function HistorySection({
  emptyLabel,
  pending,
  rows,
  serviceMap,
  isTipSection,
  onRowClick,
}: {
  emptyLabel: string;
  pending: boolean;
  rows: Booking[];
  serviceMap: Map<string, Service>;
  isTipSection?: boolean;
  onRowClick?: (booking: Booking) => void;
}) {
  return (
    <div className="card p-6">
      {pending ? (
        <ul className="divide-y divide-gray-200">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i}>
              <HistoryRowSkeleton />
            </li>
          ))}
        </ul>
      ) : rows.length === 0 ? (
        <div className="text-sm text-muted-foreground">{emptyLabel}</div>
      ) : (
        <ul className="divide-y divide-gray-200">
          {rows.map((b) => {
            const content = (
              <>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    {b.code && (
                      <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5">
                        #{b.code}
                      </span>
                    )}
                    <span className="font-medium truncate">
                      {serviceTitles(b.serviceIds, serviceMap)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {b.slotStartAt
                      ? formatDate(b.slotStartAt)
                      : formatDate(b.createdAt)}
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-medium">
                    {formatNaira(b.amountKobo)}
                  </div>
                  {isTipSection ? (
                    <span className="inline-block px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide bg-amber-50 text-amber-800 mt-1">
                      Tip
                    </span>
                  ) : (
                    <StatusPill status={b.status} />
                  )}
                </div>
              </>
            );

            // Bookings open the shared detail drawer; tips are read-only
            // rows on this page (they get their own drilldown from TipsPage).
            return (
              <li key={b.id}>
                {onRowClick ? (
                  <button
                    type="button"
                    onClick={() => onRowClick(b)}
                    className="w-full py-3 flex items-center justify-between gap-4 text-left hover:bg-gray-50 -mx-2 px-2 transition"
                  >
                    {content}
                  </button>
                ) : (
                  <div className="py-3 flex items-center justify-between gap-4">
                    {content}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  hint,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 text-muted-foreground mb-2">
        {icon}
        <span className="text-xs font-medium uppercase tracking-wide">
          {label}
        </span>
      </div>
      <div className="text-2xl font-bold tracking-tight">{value}</div>
      {hint && <div className="text-xs text-muted-foreground mt-1">{hint}</div>}
    </div>
  );
}

function CustomerDetailSkeleton() {
  return (
    <>
      <div className="mb-6">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-4 w-56 mt-2" />
      </div>

      {/* Header card — avatar + contact */}
      <div className="card p-6 mb-6">
        <div className="flex items-start gap-4 flex-wrap">
          <Skeleton className="w-16 h-16 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-5 w-40" />
            <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
              <Skeleton className="h-3.5 w-28" />
              <Skeleton className="h-3.5 w-36" />
            </div>
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        {Array.from({ length: 3 }, (_, i) => (
          <StatCardSkeleton key={i} />
        ))}
      </div>

      {/* Segmented pill tabs */}
      <div className="mb-5 inline-flex bg-gray-100 p-1 gap-1">
        <Skeleton className="h-7 w-24" />
        <Skeleton className="h-7 w-16" />
      </div>

      <div className="card p-6">
        <ul className="divide-y divide-gray-200">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i}>
              <HistoryRowSkeleton />
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function StatCardSkeleton() {
  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-2">
        <Skeleton className="w-5 h-5" />
        <Skeleton className="h-3 w-24" />
      </div>
      <Skeleton className="h-7 w-20" />
    </div>
  );
}

function HistoryRowSkeleton() {
  return (
    <div className="py-3 flex items-center justify-between gap-4">
      <div className="min-w-0 flex-1 space-y-1.5">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-32" />
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <Skeleton className="h-4 w-16" />
        <Skeleton className="h-3 w-12" />
      </div>
    </div>
  );
}

function ErrorState({ notFound }: { notFound: boolean }) {
  return (
    <div className="card p-10 text-center">
      <h3 className="text-lg font-semibold mb-1">
        {notFound ? "Customer not found" : "Couldn't load customer"}
      </h3>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        {notFound
          ? "This customer might have been removed, or the link is off."
          : "Try again in a moment."}
      </p>
      <Link to="/dashboard/customers" className="btn-secondary mt-5 inline-flex">
        Back to customers
      </Link>
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

// Mirror of DashboardHomePage's STATUS_STYLE — not exported there, kept in sync manually.
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

function serviceTitles(
  ids: string[],
  map: Map<string, Service>,
): string {
  if (!ids.length) return "—";
  const titles = ids.map((id) => map.get(id)?.title ?? "Deleted service");
  return titles.join(", ");
}

function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((s) => s[0])
      .filter(Boolean)
      .slice(0, 2)
      .join("")
      .toUpperCase() || "?"
  );
}

function humanizeRelative(iso: string | null): string {
  if (!iso) return "Never";
  const diffMs = Date.now() - new Date(iso).getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hr${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} mo ago`;
  const yr = Math.floor(day / 365);
  return `${yr} yr${yr === 1 ? "" : "s"} ago`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function isNotFound(err: unknown): boolean {
  return (
    !!err &&
    typeof err === "object" &&
    "status" in err &&
    (err as { status?: number }).status === 404
  );
}
