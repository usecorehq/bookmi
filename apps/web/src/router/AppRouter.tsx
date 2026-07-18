import { Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { LandingPage } from "@/pages/LandingPage";

/**
 * Bookmi routes — filled in through Day 1/2:
 *   /                                landing
 *   /login, /signup                  auth (from qore-menu, adapted)
 *   /dashboard, /dashboard/*         host dashboard
 *   /:slug                           public host page
 *   /:slug/checkout/:serviceId       checkout
 *   /:slug/confirmed/:bookingId      confirmation
 */
export function AppRouter() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
      </Routes>
    </AuthProvider>
  );
}
