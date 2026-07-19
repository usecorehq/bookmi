import type { BookingStatus, BookingSource } from "@bookmi/shared-types";

const STATUSES: Array<{ value: BookingStatus | "all"; label: string }> = [
  { value: "all", label: "All" },
  { value: "pending", label: "Pending" },
  { value: "confirmed", label: "Confirmed" },
  { value: "arrived", label: "Arrived" },
  { value: "seated", label: "Seated" },
  { value: "completed", label: "Completed" },
  { value: "canceled", label: "Canceled" },
  { value: "no_show", label: "No-show" },
  { value: "failed", label: "Failed" },
];

const SOURCES: Array<{ value: BookingSource | "all"; label: string }> = [
  { value: "all", label: "All sources" },
  // "storefront" stays as the DB value; the chip label mirrors what
  // BookingDetailModal renders in its SourcePill map ("Public").
  { value: "storefront", label: "Public" },
  { value: "dashboard", label: "Dashboard" },
];

export function StatusFilter({
  value,
  onChange,
}: {
  value: BookingStatus | "all";
  onChange: (v: BookingStatus | "all") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STATUSES.map((s) => (
        <Chip
          key={s.value}
          active={value === s.value}
          onClick={() => onChange(s.value)}
        >
          {s.label}
        </Chip>
      ))}
    </div>
  );
}

export function SourceFilter({
  value,
  onChange,
}: {
  value: BookingSource | "all";
  onChange: (v: BookingSource | "all") => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {SOURCES.map((s) => (
        <Chip
          key={s.value}
          active={value === s.value}
          onClick={() => onChange(s.value)}
        >
          {s.label}
        </Chip>
      ))}
    </div>
  );
}

function Chip({
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
      className={`px-3 py-1 text-xs border transition ${
        active
          ? "border-primary bg-primary-light text-primary font-medium"
          : "border-gray-200 text-muted-foreground hover:bg-gray-50"
      }`}
    >
      {children}
    </button>
  );
}
