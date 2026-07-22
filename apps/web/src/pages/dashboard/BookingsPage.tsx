import { useMemo, useState } from "react";
import { CalendarDays, Plus, Search } from "lucide-react";
import type { BookingSource, BookingStatus } from "@bookmi/shared-types";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { BookingRow, BookingRowSkeleton } from "@/components/dashboard/bookings/BookingRow";
import { CalendarGrid } from "@/components/dashboard/bookings/CalendarGrid";
import { NewBookingModal } from "@/components/dashboard/bookings/NewBookingModal";
import {
  SourceFilter,
  StatusFilter,
} from "@/components/dashboard/bookings/StatusFilter";
import { useDebounce } from "@/hooks/useDebounce";
import { useHostBookings } from "@/hooks/useHostBookings";
import { useHostServices } from "@/hooks/useHostServices";

type Tab = "all" | "calendar";

function toIso(dateStr: string, endOfDay = false): string | undefined {
  if (!dateStr) return undefined;
  return endOfDay
    ? new Date(`${dateStr}T23:59:59.999Z`).toISOString()
    : new Date(`${dateStr}T00:00:00.000Z`).toISOString();
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export default function BookingsPage() {
  const [tab, setTab] = useState<Tab>("all");
  const [modalOpen, setModalOpen] = useState(false);
  const servicesQ = useHostServices();
  const services = servicesQ.data ?? [];

  return (
    <div>
      <PageHeader
        title="Bookings"
        subtitle="All bookings and tips, plus a live calendar view."
        actions={
          <button
            type="button"
            onClick={() => setModalOpen(true)}
            className="btn-primary inline-flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> New Booking
          </button>
        }
      />

      <div className="mb-5 inline-flex bg-gray-100 p-1">
        <TabButton active={tab === "all"} onClick={() => setTab("all")}>
          All Bookings
        </TabButton>
        <TabButton
          active={tab === "calendar"}
          onClick={() => setTab("calendar")}
        >
          <CalendarDays className="w-4 h-4 inline mr-1.5 -mt-0.5" />
          Calendar
        </TabButton>
      </div>

      {tab === "all" ? (
        <AllBookingsTab services={services} />
      ) : (
        <CalendarTab services={services} />
      )}

      {modalOpen && <NewBookingModal onClose={() => setModalOpen(false)} />}
    </div>
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

// ============================================================================
// Tab 1: All Bookings
// ============================================================================

function AllBookingsTab({
  services,
}: {
  services: import("@bookmi/shared-types").Service[];
}) {
  const [status, setStatus] = useState<BookingStatus | "all">("all");
  const [source, setSource] = useState<BookingSource | "all">("all");
  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [q, setQ] = useState<string>("");
  const debouncedQ = useDebounce(q, 250);

  const bookingsQ = useHostBookings({
    status: status === "all" ? undefined : status,
    source: source === "all" ? undefined : source,
    from: toIso(from, false),
    to: toIso(to, true),
    q: debouncedQ.trim() || undefined,
    kind: "booking",
    limit: 100,
  });
  const bookings = bookingsQ.data ?? [];

  return (
    <>
      <div className="card p-4 mb-4 space-y-3">
        <StatusFilter value={status} onChange={setStatus} />
        <div className="flex flex-wrap items-center gap-3">
          <SourceFilter value={source} onChange={setSource} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto_auto] gap-3 pt-1">
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              Search
            </label>
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
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              From
            </label>
            <input
              type="date"
              className="input-field"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
              To
            </label>
            <input
              type="date"
              className="input-field"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </div>
        </div>
      </div>

      <div className="card p-4">
        {bookingsQ.isPending ? (
          <div>
            {Array.from({ length: 5 }, (_, i) => (
              <BookingRowSkeleton key={i} />
            ))}
          </div>
        ) : bookings.length === 0 ? (
          <div className="text-sm text-muted-foreground py-8 text-center">
            No bookings match these filters.
          </div>
        ) : (
          <div>
            {bookings.map((b) => (
              <BookingRow key={b.id} booking={b} services={services} />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ============================================================================
// Tab 2: Calendar
// ============================================================================

function CalendarTab({
  services,
}: {
  services: import("@bookmi/shared-types").Service[];
}) {
  const [cursor, setCursor] = useState<Date>(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState<Date | null>(() => new Date());

  const monthStart = useMemo(
    () => new Date(cursor.getFullYear(), cursor.getMonth(), 1),
    [cursor],
  );
  const monthEnd = useMemo(
    () =>
      new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0, 23, 59, 59, 999),
    [cursor],
  );

  const bookingsQ = useHostBookings({
    from: monthStart.toISOString(),
    to: monthEnd.toISOString(),
    kind: "booking",
    limit: 200,
  });
  const bookings = bookingsQ.data ?? [];

  const bookingsForSelectedDay = useMemo(() => {
    if (!selectedDate) return [];
    return bookings
      .filter(
        (b) => b.slotStartAt && sameDay(new Date(b.slotStartAt), selectedDate),
      )
      .sort((a, b) =>
        (a.slotStartAt ?? "").localeCompare(b.slotStartAt ?? ""),
      );
  }, [bookings, selectedDate]);

  const goPrev = () =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1));
  const goNext = () =>
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1));

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
      <div className="card p-4">
        {bookingsQ.isPending ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : (
          <CalendarGrid
            cursor={cursor}
            bookings={bookings}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onPrevMonth={goPrev}
            onNextMonth={goNext}
          />
        )}
      </div>

      <div className="card p-4">
        <div className="mb-3">
          <h3 className="text-sm font-semibold">
            {selectedDate
              ? selectedDate.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "short",
                  day: "numeric",
                })
              : "Pick a day"}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {bookingsForSelectedDay.length}{" "}
            {bookingsForSelectedDay.length === 1 ? "booking" : "bookings"}
          </p>
        </div>
        <div className="max-h-[70vh] overflow-y-auto">
          {!selectedDate ? (
            <div className="text-sm text-muted-foreground">
              Click a day on the calendar.
            </div>
          ) : bookingsForSelectedDay.length === 0 ? (
            <div className="text-sm text-muted-foreground">Nothing scheduled.</div>
          ) : (
            bookingsForSelectedDay.map((b) => (
              <BookingRow key={b.id} booking={b} services={services} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
