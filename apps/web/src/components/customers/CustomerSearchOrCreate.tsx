import { useEffect, useRef, useState } from "react";
import { Search, UserPlus, X, Loader2 } from "lucide-react";
import type { Customer } from "@bookmi/shared-types";
import { useCustomerSearch } from "@/hooks/useCustomers";
import { useDebounce } from "@/hooks/useDebounce";
import { formatNaira } from "@/lib/utils";

export interface CustomerDraft {
  customerId: string | null;
  name: string;
  phone: string;
  email: string;
}

/**
 * Dashboard-only customer picker. Two modes, one component:
 *
 *   - **search**  — host types a name/phone/email; matching customers
 *                   render as suggestions. Picking one fills the draft with
 *                   that customer's fields and locks `customerId`.
 *   - **create**  — host clicks "New customer" (or hits enter with no
 *                   suggestions). Fields are editable; `customerId` is null.
 *                   Submit lets the backend's `resolveOrCreate` dedup on
 *                   phone/email before insert.
 *
 * The parent owns the draft state (single source of truth for the whole
 * booking form). This component only mutates it.
 */
export function CustomerSearchOrCreate({
  value,
  onChange,
  disabled,
}: {
  value: CustomerDraft;
  onChange: (draft: CustomerDraft) => void;
  disabled?: boolean;
}) {
  const [mode, setMode] = useState<"search" | "create">(
    value.customerId ? "search" : "search",
  );
  const [term, setTerm] = useState("");
  const debounced = useDebounce(term, 250);
  const searchQ = useCustomerSearch(debounced);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const pickExisting = (c: Customer) => {
    onChange({
      customerId: c.id,
      name: c.name,
      phone: c.phone ?? "",
      email: c.email ?? "",
    });
    setTerm("");
    setOpen(false);
    setMode("search");
  };

  const clearSelection = () => {
    onChange({ customerId: null, name: "", phone: "", email: "" });
    setTerm("");
    setMode("search");
  };

  const startCreate = () => {
    onChange({ customerId: null, name: term, phone: "", email: "" });
    setOpen(false);
    setMode("create");
  };

  const selected = value.customerId != null;

  return (
    <div ref={rootRef} className="space-y-3">
      {mode === "search" && !selected && (
        <div className="relative">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              className="input-field pl-10"
              placeholder="Search by name, phone, or email…"
              value={term}
              onChange={(e) => {
                setTerm(e.target.value);
                setOpen(true);
              }}
              onFocus={() => setOpen(true)}
              disabled={disabled}
              autoComplete="off"
            />
            {term && (
              <button
                type="button"
                onClick={() => setTerm("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {open && (term.length >= 2 || searchQ.isFetching) && (
            <div className="absolute left-0 right-0 mt-1 bg-white border border-gray-200 shadow-lg z-20 max-h-72 overflow-y-auto">
              {searchQ.isFetching && (
                <div className="px-3 py-2 text-xs text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="w-3 h-3 animate-spin" /> Searching…
                </div>
              )}
              {!searchQ.isFetching && (searchQ.data ?? []).length === 0 && (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  No matches.
                </div>
              )}
              {(searchQ.data ?? []).map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => pickExisting(c)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-none"
                >
                  <div className="text-sm font-medium">{c.name}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-3 mt-0.5">
                    {c.phone && <span>{c.phone}</span>}
                    {c.email && <span>{c.email}</span>}
                    <span className="ml-auto">
                      {c.totalBookings} bookings · {formatNaira(c.totalSpentKobo)}
                    </span>
                  </div>
                </button>
              ))}
              <button
                type="button"
                onClick={startCreate}
                className="w-full text-left px-3 py-2 hover:bg-primary-light text-primary flex items-center gap-2 border-t border-gray-200"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span className="text-sm">
                  Create new customer{term ? ` "${term}"` : ""}
                </span>
              </button>
            </div>
          )}
        </div>
      )}

      {(selected || mode === "create") && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">
              {selected ? "Selected customer" : "New customer"}
            </div>
            <button
              type="button"
              onClick={clearSelection}
              className="text-xs text-primary hover:underline"
              disabled={disabled}
            >
              {selected ? "Change" : "Cancel"}
            </button>
          </div>

          <input
            type="text"
            className="input-field"
            placeholder="Full name"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
            required
            maxLength={120}
            disabled={disabled || selected}
          />
          <input
            type="tel"
            className="input-field"
            placeholder="Phone (dedupes repeat customers)"
            value={value.phone}
            onChange={(e) => onChange({ ...value, phone: e.target.value })}
            maxLength={40}
            disabled={disabled || selected}
          />
          <input
            type="email"
            className="input-field"
            placeholder="Email (optional)"
            value={value.email}
            onChange={(e) => onChange({ ...value, email: e.target.value })}
            maxLength={200}
            disabled={disabled || selected}
          />
        </div>
      )}
    </div>
  );
}
