import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Route wrapper. Two states:
 *   - Still verifying session → transparent placeholder (avoids flashing login)
 *   - Not signed in → /auth/login, preserving where they were headed
 *   - Otherwise → render children
 *
 * Only guards `/onboarding` today — `/dashboard/*` does its own auth-gating
 * inside `DashboardLayout` so its persistent sidebar shell can render
 * immediately on a hard refresh instead of this generic, chrome-less
 * "Loading…" screen. Keep this component simple; if a second standalone
 * (no-shell) authed route shows up, this is still the right wrapper for it.
 */
export function RequireAuth() {
  const { loading, session } = useAuth();
  const location = useLocation();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading…</div>
      </div>
    );
  }

  if (!session) {
    return (
      <Navigate
        to={`/auth/login?redirect=${encodeURIComponent(location.pathname + location.search)}`}
        replace
      />
    );
  }

  return <Outlet />;
}
