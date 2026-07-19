import { useState } from "react";
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

/**
 * Two-column profile shell: tab sidebar on the left, the active section
 * on the right. Each section owns its own draft state + save mutation —
 * this page only picks which section is visible and hands it the loaded
 * `profile`.
 */
export default function ProfilePage() {
  const { profile } = useAuth();
  const [tab, setTab] = useState<ProfileTab>("identity");

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
