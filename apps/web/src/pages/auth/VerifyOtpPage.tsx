import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { AuthLayout } from "@/components/layouts/AuthLayout";
import { FormMessage } from "@/components/ui/FormMessage";

/**
 * Supabase email OTP verification. The email links back here with the code,
 * or the user can paste it manually. Flow parameter chooses the redirect:
 * - signup → /onboarding
 * - recovery → /auth/update-password
 *
 * When the email button is clicked, the URL carries `code=<6-digit token>`
 * so we auto-fill and submit. Belt + braces: the code is also visible in the
 * email body for anyone whose button opens a browser they're not signed into.
 */
export default function VerifyOtpPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const flow = searchParams.get("flow") === "recovery" ? "recovery" : "signup";
  const email = searchParams.get("email") ?? "";
  const codeFromUrl = searchParams.get("code") ?? "";

  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);
  const [resent, setResent] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const autoSubmittedRef = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setInterval(() => setCooldown((c) => Math.max(0, c - 1)), 1000);
    return () => clearInterval(t);
  }, [cooldown]);

  const verifyCode = useCallback(
    async (token: string) => {
      setError(null);
      setLoading(true);
      try {
        const { error: otpError } = await supabase.auth.verifyOtp({
          email,
          token,
          type: flow === "recovery" ? "recovery" : "email",
        });
        if (otpError) throw otpError;
        navigate(flow === "recovery" ? "/auth/update-password" : "/onboarding", {
          replace: true,
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Invalid or expired code");
      } finally {
        setLoading(false);
      }
    },
    [email, flow, navigate],
  );

  // If the email's button dropped us here with ?code=<token>, prefill and
  // auto-submit after a beat so the user sees what's happening.
  useEffect(() => {
    if (autoSubmittedRef.current) return;
    if (!codeFromUrl || codeFromUrl.length < 4 || !email) return;
    autoSubmittedRef.current = true;
    setCode(codeFromUrl);
    const t = setTimeout(() => verifyCode(codeFromUrl), 400);
    return () => clearTimeout(t);
  }, [codeFromUrl, email, verifyCode]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await verifyCode(code);
  };

  const handleResend = async () => {
    if (cooldown > 0) return;
    setResending(true);
    setError(null);
    setResent(false);
    try {
      if (flow === "recovery") {
        const { error: e } = await supabase.auth.resetPasswordForEmail(email, {
          redirectTo: `${window.location.origin}/auth/verify-otp?flow=recovery&email=${encodeURIComponent(email)}`,
        });
        if (e) throw e;
      } else {
        const { error: e } = await supabase.auth.resend({ type: "signup", email });
        if (e) throw e;
      }
      setResent(true);
      setCooldown(60);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to resend code");
    } finally {
      setResending(false);
    }
  };

  const copy = useMemo(() => {
    if (flow === "recovery") {
      return {
        heading: "Reset your password",
        subtext: email
          ? `Enter the 6-digit code we sent to ${email} to continue.`
          : "Enter the 6-digit code we sent you.",
      };
    }
    return {
      heading: "Verify your email",
      subtext: email
        ? `Enter the 6-digit code we sent to ${email}.`
        : "Enter the 6-digit code we sent you.",
    };
  }, [flow, email]);

  const backLink = flow === "recovery" ? "/auth/forgot-password" : "/auth/signup";
  const backLabel = flow === "recovery" ? "Back to reset password" : "Back to sign up";

  return (
    <AuthLayout>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Bookmi</h1>
          <p className="text-sm text-muted-foreground mt-1">by <a href="https://qorelly.com/" target="_blank" rel="noopener noreferrer">Qorelly</a></p>
        </div>
        <div className="card p-8">
          <h2 className="text-2xl font-semibold mb-1">{copy.heading}</h2>
          <p className="text-sm text-muted-foreground mb-6">{copy.subtext}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Verification code</label>
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
                autoFocus
              />
              <p className="text-xs text-muted-foreground mt-2 text-center">
                Or click the link we sent to your email.
              </p>
            </div>
            {resent && <FormMessage variant="success" message={`New code sent to ${email}.`} />}
            {error && <FormMessage variant="error" message={error} />}
            <button
              type="submit"
              disabled={loading || code.length !== 6}
              className="btn-primary w-full"
            >
              {loading ? "Verifying…" : "Verify"}
            </button>
          </form>

          <div className="mt-6 flex items-center justify-between text-sm">
            <button
              type="button"
              onClick={handleResend}
              disabled={resending || cooldown > 0 || !email}
              className="text-primary hover:underline font-medium disabled:text-muted-foreground disabled:no-underline"
            >
              {cooldown > 0
                ? `Resend in ${cooldown}s`
                : resending
                  ? "Sending…"
                  : "Resend code"}
            </button>
            <Link to={backLink} className="text-gray-500 hover:text-gray-700">
              {backLabel}
            </Link>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
}
