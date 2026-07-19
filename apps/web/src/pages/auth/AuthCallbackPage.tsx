import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { AuthLayout } from "@/components/layouts/AuthLayout";

/**
 * Landing page for PKCE code exchange after email confirmation / recovery.
 *
 * - `?code=…&flow=signup` → exchange, then /onboarding
 * - `?code=…&flow=recovery` → exchange, then /auth/update-password
 * - no code → treat as verification failure and bounce to login
 */
export default function AuthCallbackPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const code = searchParams.get("code");
    const flow = searchParams.get("flow") === "recovery" ? "recovery" : "signup";

    if (!code) {
      navigate("/auth/login?message=verification_failed", { replace: true });
      return;
    }

    supabase.auth
      .exchangeCodeForSession(code)
      .then(({ error: e }) => {
        if (e) {
          setError(e.message);
          navigate("/auth/login?message=verification_failed", { replace: true });
          return;
        }
        navigate(flow === "recovery" ? "/auth/update-password" : "/onboarding", {
          replace: true,
        });
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Verification failed");
        navigate("/auth/login?message=verification_failed", { replace: true });
      });
  }, [searchParams, navigate]);

  return (
    <AuthLayout>
      <div className="w-full max-w-md">
        <div className="card p-12 text-center">
          <div className="text-lg font-medium mb-2">Verifying…</div>
          <p className="text-sm text-muted-foreground">
            {error ?? "Hang tight, this takes a second."}
          </p>
        </div>
      </div>
    </AuthLayout>
  );
}
