import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

interface Props {
  /** When true, requires the user has completed onboarding (has a host_profile row). */
  requireOnboarded?: boolean;
}

/**
 * Route wrapper. Three states:
 *   - Still verifying session → transparent placeholder (avoids flashing login)
 *   - Not signed in → /auth/login, preserving where they were headed
 *   - Signed in but no profile + `requireOnboarded` → /onboarding
 *   - Otherwise → render children
 *
 * Reserved for host-facing routes only; the public `/:slug` page is unguarded.
 */
export function RequireAuth({ requireOnboarded = false }: Props) {
  const { loading, session, profile } = useAuth();
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

  if (requireOnboarded && !profile) {
    return <Navigate to="/onboarding" replace />;
  }

  return <Outlet />;
}
