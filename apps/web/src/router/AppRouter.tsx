import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { DashboardLayout } from "@/components/layouts/DashboardLayout";
import { LandingPage } from "@/pages/LandingPage";
import LoginPage from "@/pages/auth/LoginPage";
import SignupPage from "@/pages/auth/SignupPage";
import ForgotPasswordPage from "@/pages/auth/ForgotPasswordPage";
import VerifyOtpPage from "@/pages/auth/VerifyOtpPage";
import UpdatePasswordPage from "@/pages/auth/UpdatePasswordPage";
import AuthCallbackPage from "@/pages/auth/AuthCallbackPage";
import OnboardingPage from "@/pages/onboarding/OnboardingPage";
import DashboardHomePage from "@/pages/dashboard/DashboardHomePage";
import ProfilePage from "@/pages/dashboard/ProfilePage";
import ServicesPage from "@/pages/dashboard/ServicesPage";
import BookingsPage from "@/pages/dashboard/BookingsPage";
import TipsPage from "@/pages/dashboard/TipsPage";
import WalletPage from "@/pages/dashboard/WalletPage";
import CustomersPage from "@/pages/dashboard/CustomersPage";
import CustomerDetailPage from "@/pages/dashboard/CustomerDetailPage";
import HostPublicPage from "@/pages/public/HostPublicPage";

/**
 * Bookmi routes:
 *   /                                  landing
 *   /auth/{login|signup|forgot-password|verify-otp|update-password|callback}
 *   /onboarding                        (requireAuth)
 *   /dashboard/*                       (requireAuth + requireOnboarded) → DashboardLayout
 *   /:slug                             public host page (later)
 *   /:slug/checkout/:serviceId         checkout (later)
 */
export function AppRouter() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/auth/login" element={<LoginPage />} />
        <Route path="/auth/signup" element={<SignupPage />} />
        <Route path="/auth/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/auth/verify-otp" element={<VerifyOtpPage />} />
        <Route path="/auth/update-password" element={<UpdatePasswordPage />} />
        <Route path="/auth/callback" element={<AuthCallbackPage />} />

        <Route element={<RequireAuth />}>
          <Route path="/onboarding" element={<OnboardingPage />} />
        </Route>

        <Route element={<RequireAuth requireOnboarded />}>
          <Route path="/dashboard" element={<DashboardLayout />}>
            <Route index element={<DashboardHomePage />} />
            <Route path="services" element={<ServicesPage />} />
            <Route path="bookings" element={<BookingsPage />} />
            <Route path="tips" element={<TipsPage />} />
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/:id" element={<CustomerDetailPage />} />
            <Route path="wallet" element={<WalletPage />} />
            <Route path="profile" element={<ProfilePage />} />
          </Route>
        </Route>

        <Route path="/:slug" element={<HostPublicPage />} />
        <Route path="/:slug/:serviceSlug" element={<HostPublicPage />} />
      </Routes>
    </AuthProvider>
  );
}

