import { useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { AuthLayout } from "@/components/layouts/AuthLayout";
import { FormMessage } from "@/components/ui/FormMessage";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/auth/callback?flow=recovery`,
      });
      if (resetError) throw resetError;
      setStatus("sent");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send reset link");
    } finally {
      setLoading(false);
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
          {status === "sent" ? (
            <>
              <h2 className="text-2xl font-semibold mb-2">Check your email</h2>
              <p className="text-sm text-muted-foreground mb-6">
                We sent a password-reset link to <strong>{email}</strong>. Follow the link to set a
                new password.
              </p>
              <Link to="/auth/login" className="btn-secondary w-full">
                Back to sign in
              </Link>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-semibold mb-1">Forgot password</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Enter your email and we'll send you a reset link.
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
                  />
                </div>
                {error && <FormMessage variant="error" message={error} />}
                <button type="submit" disabled={loading} className="btn-primary w-full">
                  {loading ? "Sending…" : "Send reset link"}
                </button>
              </form>
              <div className="mt-6 text-center text-sm">
                <Link to="/auth/login" className="text-primary hover:underline">
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </AuthLayout>
  );
}
