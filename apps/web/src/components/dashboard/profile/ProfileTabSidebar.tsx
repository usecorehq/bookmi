import { Clock, Phone, UserCircle, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";

export type ProfileTab = "identity" | "contact" | "hours" | "payout";

interface TabDef {
  id: ProfileTab;
  label: string;
  icon: typeof UserCircle;
}

const TABS: TabDef[] = [
  { id: "identity", label: "Identity", icon: UserCircle },
  { id: "contact", label: "Contact", icon: Phone },
  { id: "hours", label: "Operating Hours", icon: Clock },
  { id: "payout", label: "Payout Details", icon: Wallet },
];

interface ProfileTabSidebarProps {
  value: ProfileTab;
  onChange: (tab: ProfileTab) => void;
}

/**
 * Vertical tab list on desktop, horizontal chip row on mobile. Selection
 * is kept in the parent so section state survives tab switches — well,
 * as long as the sections stay mounted (they do NOT here; each tab
 * renders fresh, and each section re-derives its draft from `profile`).
 */
export function ProfileTabSidebar({ value, onChange }: ProfileTabSidebarProps) {
  return (
    <nav
      aria-label="Profile sections"
      className={cn(
        // Desktop: vertical stack. Mobile: horizontal scrollable chip row.
        "flex md:flex-col gap-1 overflow-x-auto md:overflow-visible",
        "md:sticky md:top-4",
      )}
    >
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const active = value === tab.id;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 text-sm text-left transition-colors whitespace-nowrap shrink-0",
              active
                ? "bg-primary-light text-primary font-medium"
                : "text-gray-700 hover:bg-gray-50",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="w-4 h-4 shrink-0" />
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
}
