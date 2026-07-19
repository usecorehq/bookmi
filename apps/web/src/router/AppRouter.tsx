import { Route, Routes } from "react-router-dom";
import { AuthProvider } from "@/contexts/AuthContext";
import { RequireAuth } from "@/components/auth/RequireAuth";
import { LandingPage } from "@/pages/LandingPage";
import LoginPage from "@/pages/auth/LoginPage";
import SignupPage from "@/pages/auth/SignupPage";
import ForgotPasswordPage from "@/pages/auth/ForgotPasswordPage";
import VerifyOtpPage from "@/pages/auth/VerifyOtpPage";
import UpdatePasswordPage from "@/pages/auth/UpdatePasswordPage";
import AuthCallbackPage from "@/pages/auth/AuthCallbackPage";

/**
 * Bookmi routes:
 *   /                                  landing
 *   /auth/{login|signup|forgot-password|verify-otp|update-password|callback}
 *   /onboarding                        (requireAuth)
 *   /dashboard/*                       (requireAuth + requireOnboarded)
 *   /:slug                             public host page
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

        {/* Onboarding is signed-in-only. Dashboard requires an onboarded profile. */}
        <Route element={<RequireAuth />}>
          <Route path="/onboarding" element={<OnboardingPlaceholder />} />
        </Route>
        <Route element={<RequireAuth requireOnboarded />}>
          <Route path="/dashboard" element={<DashboardPlaceholder />} />
        </Route>
      </Routes>
    </AuthProvider>
  );
}

// Task #39 fills these in.
function OnboardingPlaceholder() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md text-center space-y-3">
        <div className="text-lg font-semibold">Onboarding coming up</div>
        <p className="text-sm text-muted-foreground">
          You're signed in. The slug picker screen lands in the next commit.
        </p>
      </div>
    </div>
  );
}

function DashboardPlaceholder() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="max-w-md text-center space-y-3">
        <div className="text-lg font-semibold">Dashboard coming up</div>
        <p className="text-sm text-muted-foreground">
          You're signed in and onboarded. The dashboard lands soon.
        </p>
      </div>
    </div>
  );
}
