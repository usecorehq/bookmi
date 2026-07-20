import { useState, type ReactNode } from "react";
import { NavLink, Outlet, Link } from "react-router-dom";
import {
  LayoutGrid,
  Tag,
  CalendarDays,
  Coffee,
  Users,
  Wallet,
  UserCircle,
  ExternalLink,
  LogOut,
  Menu,
  X,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

interface NavItem {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  end?: boolean;
  external?: boolean;
}

const PRIMARY_NAV: NavItem[] = [
  { to: "/dashboard", label: "Dashboard", icon: LayoutGrid, end: true },
  { to: "/dashboard/bookings", label: "Bookings", icon: CalendarDays },
  { to: "/dashboard/tips", label: "Tips", icon: Coffee },
  { to: "/dashboard/services", label: "Services", icon: Tag },
  { to: "/dashboard/customers", label: "Customers", icon: Users },
  { to: "/dashboard/wallet", label: "Wallet", icon: Wallet },
  { to: "/dashboard/profile", label: "Profile", icon: UserCircle },
];

/**
 * Sidebar + main area shell for /dashboard/*. Static navItems array —
 * qore-menu's DashboardLayout supports business switcher, workspace
 * scope, permission gates, feature flags, and terminal mode; bookmi
 * needs none of that today.
 */
export function DashboardLayout() {
  const { profile, signOut } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Mobile header — visible < md */}
      <div className="md:hidden sticky top-0 z-30 flex items-center justify-between bg-white border-b border-gray-200 px-4 py-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-primary rounded-none flex items-center justify-center text-white font-bold">
            b
          </div>
          <span className="font-semibold">Bookmi</span>
        </div>
        <button
          type="button"
          onClick={() => setMobileOpen((v) => !v)}
          className="p-2 text-gray-600"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      <div className="flex">
        {/* Sidebar — always visible on md+, drawer on mobile */}
        <aside
          className={cn(
            "fixed md:sticky top-0 left-0 z-20 h-screen w-64 bg-white border-r border-gray-200",
            "md:flex flex-col",
            mobileOpen ? "flex" : "hidden md:flex",
          )}
        >
          <div className="hidden md:flex items-center gap-2 px-6 py-5 border-b border-gray-200">
            <div className="w-8 h-8 bg-primary rounded-none flex items-center justify-center text-white font-bold">
              b
            </div>
            <div>
              <div className="font-semibold leading-tight">Bookmi</div>
              <div className="text-xs text-muted-foreground">by Qorelly</div>
            </div>
          </div>

          <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
            {PRIMARY_NAV.map((item) => (
              <NavItemLink
                key={item.to}
                item={item}
                onNavigate={() => setMobileOpen(false)}
              />
            ))}
            {/* External "View my page" link — only if slug exists */}
            {profile?.slug && (
              <a
                href={`/${profile.slug}`}
                target="_blank"
                rel="noreferrer"
                onClick={() => setMobileOpen(false)}
                className="flex items-center gap-3 px-3 py-2.5 text-sm text-gray-700 hover:bg-primary-light hover:text-primary transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                View my page
              </a>
            )}
          </nav>

          <div className="border-t border-gray-200 px-3 py-3 space-y-2">
            <div className="px-3 py-2 text-xs text-muted-foreground">
              <div className="font-semibold text-gray-900 truncate">
                {profile?.displayName ?? "Your page"}
              </div>
              {profile?.slug && <div className="truncate">book.me/{profile.slug}</div>}
            </div>
            <button
              type="button"
              onClick={() => signOut()}
              className="flex items-center gap-2 w-full px-3 py-2 text-sm text-gray-700 hover:bg-gray-100 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </aside>

        <main className="flex-1 min-w-0">
          <div className="max-w-6xl mx-auto p-4 md:p-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}

function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          "flex items-center gap-3 px-3 py-2.5 text-sm transition-colors",
          isActive
            ? "bg-primary-light text-primary font-medium"
            : "text-gray-700 hover:bg-gray-100",
        )
      }
    >
      <Icon className="w-4 h-4" />
      {item.label}
    </NavLink>
  );
}

/** Small helper used by dashboard pages to prefix a section title. */
export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex items-start justify-between mb-6 gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
