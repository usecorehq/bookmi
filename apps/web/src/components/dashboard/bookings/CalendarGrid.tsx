import { useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { Booking } from "@bookmi/shared-types";

const WEEKDAYS_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/**
 * Same UTC-safe day key used to bucket bookings by their `slotStartAt`.
 * We ignore timezones because the storefront + dashboard operate in the
 * host's local time; a bad bucket is worse than 1-day-off in edge cases.
 */
function dayKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function sameDay(a: Date, b: Date): boolean {
  return dayKey(a) === dayKey(b);
}

interface CalendarCell {
  date: Date;
  inMonth: boolean;
  bookings: Booking[];
}

function buildGrid(cursor: Date, bookings: Booking[]): CalendarCell[] {
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0=Sun
  const gridStart = new Date(year, month, 1 - startWeekday);

  // Bucket bookings by dayKey once — the grid then just reads.
  const byDay = new Map<string, Booking[]>();
  for (const b of bookings) {
    if (!b.slotStartAt) continue;
    const key = dayKey(new Date(b.slotStartAt));
    const list = byDay.get(key) ?? [];
    list.push(b);
    byDay.set(key, list);
  }
  for (const list of byDay.values()) {
    list.sort((a, b) =>
      (a.slotStartAt ?? "").localeCompare(b.slotStartAt ?? ""),
    );
  }

  const cells: CalendarCell[] = [];
  // 6 rows × 7 cols covers every month layout.
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(gridStart);
    date.setDate(gridStart.getDate() + i);
    cells.push({
      date,
      inMonth: date.getMonth() === month,
      bookings: byDay.get(dayKey(date)) ?? [],
    });
  }
  return cells;
}

export function CalendarGrid({
  cursor,
  bookings,
  selectedDate,
  onSelectDate,
  onPrevMonth,
  onNextMonth,
}: {
  cursor: Date;
  bookings: Booking[];
  selectedDate: Date | null;
  onSelectDate: (d: Date) => void;
  onPrevMonth: () => void;
  onNextMonth: () => void;
}) {
  const cells = useMemo(() => buildGrid(cursor, bookings), [cursor, bookings]);
  const today = new Date();

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold">
          {MONTHS[cursor.getMonth()]} {cursor.getFullYear()}
        </h2>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onPrevMonth}
            aria-label="Previous month"
            className="p-1.5 border border-gray-200 hover:bg-gray-50"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            aria-label="Next month"
            className="p-1.5 border border-gray-200 hover:bg-gray-50"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-px bg-gray-200 border border-gray-200">
        {WEEKDAYS_SHORT.map((d) => (
          <div
            key={d}
            className="bg-gray-50 py-2 text-center text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
          >
            {d}
          </div>
        ))}
        {cells.map((cell, idx) => {
          const isToday = sameDay(cell.date, today);
          const isSelected = selectedDate ? sameDay(cell.date, selectedDate) : false;
          const visible = cell.bookings.slice(0, 3);
          const overflow = cell.bookings.length - visible.length;
          return (
            <button
              key={idx}
              type="button"
              onClick={() => onSelectDate(cell.date)}
              className={`bg-white min-h-[92px] p-1.5 text-left align-top transition ${
                cell.inMonth ? "" : "opacity-40"
              } ${
                isSelected
                  ? "outline outline-2 outline-primary -outline-offset-2"
                  : ""
              } ${isToday ? "border-l-2 border-l-primary" : ""} hover:bg-gray-50`}
            >
              <div
                className={`text-xs mb-1 ${
                  isToday ? "font-semibold text-primary" : "text-muted-foreground"
                }`}
              >
                {cell.date.getDate()}
              </div>
              <div className="space-y-0.5">
                {visible.map((b) => (
                  <div
                    key={b.id}
                    className="text-[10px] px-1 py-0.5 bg-primary-light text-primary truncate"
                    title={`${b.customerName} · ${new Date(b.slotStartAt ?? "").toLocaleTimeString()}`}
                  >
                    <span className="font-medium">
                      {new Date(b.slotStartAt ?? "").toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>{" "}
                    {b.customerName}
                  </div>
                ))}
                {overflow > 0 && (
                  <div className="text-[10px] text-muted-foreground px-1">
                    +{overflow} more
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
