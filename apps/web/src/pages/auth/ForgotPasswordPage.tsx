import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { SplitAuthLayout } from "@/components/layouts/SplitAuthLayout";
import { FormMessage } from "@/components/ui/FormMessage";

/**
 * "Send reset code" → straight to /auth/verify-otp?flow=recovery&email=…
 * Matches qore-menu's flow: no "check your email" wall. Only a valid email
 * gets the code, and the OTP page is the natural next step whether the user
 * pastes the code or clicks the button in the email (auto-fills + submits).
 */
export default function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        // Only used as a fallback if the send-email hook is disabled.
        // Normal path: the API hook builds a link to /auth/verify-otp directly.
        redirectTo: `${window.location.origin}/auth/verify-otp?flow=recovery&email=${encodeURIComponent(email)}`,
      });
      if (resetError) throw resetError;
      navigate(`/auth/verify-otp?flow=recovery&email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset code");
    } finally {
      setLoading(false);
    }
  };

  return (
    <SplitAuthLayout>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src="/images/logo.svg" alt="Bookmi" className="mx-auto h-10 w-10" />
          <div className="mt-3 flex items-baseline justify-center gap-2">
            <h1 className="text-3xl font-bold">Bookmi</h1>
            <span className="text-sm text-muted-foreground">by <a href="https://qorelly.com/" target="_blank" rel="noopener noreferrer">Qorelly</a></span>
          </div>
        </div>
        <div className="card p-8">
          <h2 className="text-2xl font-semibold mb-1">Reset password</h2>
          <p className="text-sm text-muted-foreground mb-6">
            Enter your email and we'll send you a 6-digit code.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="input-field"
                placeholder="you@bookmi.co"
                required
                autoComplete="email"
                autoFocus
              />
            </div>
            {error && <FormMessage variant="error" message={error} />}
            <button type="submit" disabled={loading || !email} className="btn-primary w-full">
              {loading ? "Sending…" : "Send reset code"}
            </button>
          </form>
          <div className="mt-6 text-center text-sm">
            <Link to="/auth/login" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </div>
        </div>
      </div>
    </SplitAuthLayout>
  );
}
