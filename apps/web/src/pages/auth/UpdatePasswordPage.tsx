import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/lib/supabase";
import { AuthLayout } from "@/components/layouts/AuthLayout";
import { FormMessage } from "@/components/ui/FormMessage";

export default function UpdatePasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Guard: this route is only reachable after a successful recovery-code
    // exchange (AuthCallbackPage sets the session then redirects here).
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) {
        navigate("/auth/login?message=session_expired", { replace: true });
      } else {
        setReady(true);
      }
    });
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      navigate("/dashboard", { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update password");
    } finally {
      setLoading(false);
    }
  };

  if (!ready) return null;

  return (
    <AuthLayout>
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold">Bookmi</h1>
          <p className="text-sm text-muted-foreground mt-1">by <a href="https://qorelly.com/" target="_blank" rel="noopener noreferrer">Qorelly</a></p>
        </div>
        <div className="card p-8">
          <h2 className="text-2xl font-semibold mb-1">Set a new password</h2>
          <p className="text-sm text-muted-foreground mb-6">
            You're signed in now. Choose a strong password below.
          </p>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">New password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field"
                placeholder="At least 8 characters"
                required
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-2">Confirm password</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="input-field"
                placeholder="Type it again"
                required
                autoComplete="new-password"
                minLength={8}
              />
            </div>
            {error && <FormMessage variant="error" message={error} />}
            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Updating…" : "Update password"}
            </button>
          </form>
        </div>
      </div>
    </AuthLayout>
  );
}
