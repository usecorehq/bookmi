import { useState } from "react";
import { Link } from "react-router-dom";
import { CalendarDays, Mail, Phone, Search, Users } from "lucide-react";
import type { Customer } from "@bookmi/shared-types";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { useAuth } from "@/contexts/AuthContext";
import { useCustomerSearch, useHostCustomers } from "@/hooks/useCustomers";
import { useDebounce } from "@/hooks/useDebounce";
import { formatNaira } from "@/lib/utils";

export default function CustomersPage() {
  const [term, setTerm] = useState("");
  const debounced = useDebounce(term, 250);
  const searching = debounced.trim().length >= 2;

  const listQ = useHostCustomers();
  const searchQ = useCustomerSearch(debounced);

  const source = searching ? searchQ : listQ;
  const customers = source.data ?? [];

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Everyone who has booked or tipped you."
      />

      {/* Search */}
      <div className="card p-4 mb-4">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            className="input-field pl-10"
            placeholder="Search by name, phone, or email"
            value={term}
            onChange={(e) => setTerm(e.target.value)}
          />
        </div>
        {searching && searchQ.isFetching && (
          <p className="text-xs text-muted-foreground mt-2">Searching…</p>
        )}
      </div>

      {/* List */}
      {source.isPending ? (
        <div className="card p-6 text-sm text-muted-foreground">Loading…</div>
      ) : source.isError ? (
        <div className="card p-6 text-sm text-red-700">
          Couldn't load customers. Try again in a moment.
        </div>
      ) : customers.length === 0 ? (
        <EmptyState searching={searching} />
      ) : (
        <ul className="card divide-y divide-gray-200">
          {customers.map((c) => (
            <li key={c.id}>
              <CustomerRow customer={c} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CustomerRow({ customer }: { customer: Customer }) {
  return (
    <Link
      to={`/dashboard/customers/${customer.id}`}
      className="flex items-center gap-4 p-4 hover:bg-gray-50 transition-colors"
    >
      <Avatar name={customer.name} />

      <div className="min-w-0 flex-1">
        <div className="font-semibold truncate">{customer.name}</div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-0.5">
          {customer.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone className="w-3 h-3" />
              {customer.phone}
            </span>
          )}
          {customer.email && (
            <span className="inline-flex items-center gap-1 truncate">
              <Mail className="w-3 h-3 shrink-0" />
              <span className="truncate">{customer.email}</span>
            </span>
          )}
          {!customer.phone && !customer.email && (
            <span className="italic">No contact info</span>
          )}
        </div>
      </div>

      <div className="hidden sm:flex flex-col items-end shrink-0 min-w-[7rem]">
        <div className="text-sm font-medium">{customer.totalBookings}</div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {customer.totalBookings === 1 ? "booking" : "bookings"}
        </div>
      </div>

      <div className="hidden md:flex flex-col items-end shrink-0 min-w-[7rem]">
        <div className="text-sm font-medium">
          {formatNaira(customer.totalSpentKobo)}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          total spent
        </div>
      </div>

      <div className="flex flex-col items-end shrink-0 min-w-[6rem]">
        <div className="text-sm font-medium inline-flex items-center gap-1">
          <CalendarDays className="w-3.5 h-3.5 text-muted-foreground" />
          {humanizeRelative(customer.lastBookingAt)}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          last visit
        </div>
      </div>
    </Link>
  );
}

function Avatar({ name }: { name: string }) {
  return (
    <div className="w-11 h-11 shrink-0 bg-gray-100 text-gray-700 flex items-center justify-center font-semibold text-sm">
      {initials(name)}
    </div>
  );
}

function EmptyState({ searching }: { searching: boolean }) {
  const { profile } = useAuth();
  if (searching) {
    return (
      <div className="card p-8 text-center">
        <div className="text-sm text-muted-foreground">
          No customers matched your search.
        </div>
      </div>
    );
  }
  return (
    <div className="card p-10 text-center">
      <div className="w-12 h-12 mx-auto bg-primary-light text-primary flex items-center justify-center mb-3">
        <Users className="w-6 h-6" />
      </div>
      <h3 className="text-lg font-semibold mb-1">No customers yet</h3>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        Every checkout on your page adds a customer here automatically.
        {profile?.slug ? " Share your page to get started." : ""}
      </p>
      {profile?.slug && (
        <a
          href={`/${profile.slug}`}
          target="_blank"
          rel="noreferrer"
          className="btn-primary mt-5 inline-flex"
        >
          Open my page
        </a>
      )}
    </div>
  );
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

/** Tiny "3 days ago" formatter — avoids pulling in date-fns for one call site. */
function humanizeRelative(iso: string | null): string {
  if (!iso) return "—";
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
