import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { SplitAuthLayout } from "@/components/layouts/SplitAuthLayout";
import { FormMessage } from "@/components/ui/FormMessage";

export default function LoginPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    kind: "success" | "info" | "warning" | "error";
    text: string;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const message = searchParams.get("message");
    const reason = searchParams.get("reason");
    if (message === "email_verified") {
      setBanner({ kind: "success", text: "Email verified — sign in to continue." });
    } else if (message === "verification_failed") {
      setBanner({
        kind: "error",
        text: "That verification link expired or was already used. Try signing up again.",
      });
    } else if (message === "session_expired" || reason) {
      setBanner({
        kind: "warning",
        text: reason ?? "Your session has expired. Please sign in again.",
      });
    }
  }, [searchParams]);

  const redirectAfter = searchParams.get("redirect") ?? "/dashboard";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
      if (signInError) throw signInError;
      // AuthContext picks up the session via onAuthStateChange; navigating
      // triggers the RequireAuth check with the fresh session in place.
      navigate(redirectAfter, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign in");
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
          <div className="mb-6">
            <h2 className="font-display text-3xl mb-1">Sign in</h2>
            <p className="text-sm text-muted-foreground">Manage your bookings and page.</p>
          </div>

          {banner && (
            <div className="mb-4">
              <FormMessage variant={banner.kind} message={banner.text} />
            </div>
          )}

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

            <div>
              <label className="block text-sm font-medium mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input-field pr-11"
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {error && <FormMessage variant="error" message={error} />}

            <button type="submit" disabled={loading} className="btn-primary w-full">
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <div className="mt-6 text-center text-sm">
            <Link to="/auth/forgot-password" className="text-primary hover:underline">
              Forgot password?
            </Link>
          </div>
          <div className="mt-4 text-center text-sm">
            Don't have an account?{" "}
            <Link to="/auth/signup" className="text-primary hover:underline font-medium">
              Sign up
            </Link>
          </div>
        </div>
      </div>
    </SplitAuthLayout>
  );
}
