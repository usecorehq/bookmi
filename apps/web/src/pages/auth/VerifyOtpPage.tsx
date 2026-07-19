import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { AuthLayout } from "@/components/layouts/AuthLayout";
import { FormMessage } from "@/components/ui/FormMessage";

/**
 * Supabase email OTP verification. The email links back here with the code,
 * or the user can paste it manually. Flow parameter chooses the redirect:
 * - signup → /onboarding
 * - recovery → /auth/update-password
 */
export default function VerifyOtpPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const flow = searchParams.get("flow") === "recovery" ? "recovery" : "signup";
  const email = searchParams.get("email") ?? "";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: otpError } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: flow === "recovery" ? "recovery" : "email",
      });
      if (otpError) throw otpError;
      if (flow === "recovery") {
        navigate("/auth/update-password", { replace: true });
      } else {
        navigate("/onboarding", { replace: true });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid or expired code");
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setResending(true);
    setError(null);
    try {
      if (flow === "recovery") {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/callback?flow=recovery`,
        });
        if (e) throw e;
      } else {
        const { error: e } = await supabase.auth.resend({ type: "signup", email });
        if (e) throw e;
      }
      setResent(true);
      setCooldown(30);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setResending(false);
    }
  };

  return (
    <AuthLayout>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Bookmi</h1>
          <p className="text-sm text-muted-foreground mt-1">by Qorelly</p>
        </div>
        <div className="card p-8">
          <h2 className="text-2xl font-semibold mb-1">Enter the 6-digit code</h2>
          <p className="text-sm text-muted-foreground mb-6">
            We sent a code to {email ? <strong>{email}</strong> : "your inbox"}. It's good for 60 minutes.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              className="input-field text-center text-2xl tracking-[0.5em] font-semibold"
              placeholder="000000"
              required
            />
            {resent && <FormMessage variant="success" message="Code resent." />}
            {error && <FormMessage variant="error" message={error} />}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="btn-primary w-full"
            >
              {loading ? "Verifying…" : "Verify"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm text-muted-foreground">
            Didn't get it?{" "}
            <button
              type="button"
              onClick={handleResend}
              disabled={resending || cooldown > 0 || !email}
              className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
            >
              {cooldown > 0 ? `Resend in ${cooldown}s` : resending ? "Sending…" : "Resend"}
            </button>
          </div>
          <div className="mt-2 text-center text-sm">
            <Link to="/auth/login" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
}
