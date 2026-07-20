import { useCallback } from "react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "@/components/layouts/DashboardLayout";
import { ContactSection } from "@/components/dashboard/profile/ContactSection";
import { HoursSection } from "@/components/dashboard/profile/HoursSection";
import { IdentitySection } from "@/components/dashboard/profile/IdentitySection";
import { PayoutSection } from "@/components/dashboard/profile/PayoutSection";
import {
  ProfileTabSidebar,
  type ProfileTab,
} from "@/components/dashboard/profile/ProfileTabSidebar";
import { useAuth } from "@/contexts/AuthContext";

const VALID_TABS: ReadonlySet<ProfileTab> = new Set([
  "identity",
  "contact",
  "hours",
  "payout",
]);

/**
 * Two-column profile shell: tab sidebar on the left, the active section
 * on the right. Each section owns its own draft state + save mutation —
 * this page only picks which section is visible and hands it the loaded
 * `profile`.
 *
 * The active tab is driven by the `?tab=` query param so other surfaces
 * (e.g. the Wallet page's "Set up in Profile → Payout details" banner)
 * can deep-link right to the section that needs attention. Falls back to
 * Identity when the param is missing or invalid.
 */
export default function ProfilePage() {
  const { profile } = useAuth();
  const [params, setParams] = useSearchParams();
  const paramTab = params.get("tab");
  const tab: ProfileTab = VALID_TABS.has(paramTab as ProfileTab)
    ? (paramTab as ProfileTab)
    : "identity";

  const setTab = useCallback(
    (next: ProfileTab) => {
      // Replace history so back-button doesn't wade through every tab click.
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (next === "identity") p.delete("tab");
          else p.set("tab", next);
          return p;
        },
        { replace: true },
      );
    },
    [setParams],
  );

  return (
    <div>
      <PageHeader
        title="Profile"
        subtitle="How your Bookmi page looks + when customers can book."
      />

      {!profile ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[220px_minmax(0,1fr)] gap-6">
          <div>
            <ProfileTabSidebar value={tab} onChange={setTab} />
          </div>

          <div>
            {tab === "identity" && <IdentitySection profile={profile} />}
            {tab === "contact" && <ContactSection profile={profile} />}
            {tab === "hours" && <HoursSection profile={profile} />}
            {tab === "payout" && <PayoutSection />}
          </div>
        </div>
      )}
    </div>
  );
}
