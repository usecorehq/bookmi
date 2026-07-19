import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Eye, EyeOff } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { AuthLayout } from "@/components/layouts/AuthLayout";
import { FormMessage } from "@/components/ui/FormMessage";

export default function SignupPage() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setLoading(true);
    try {
      const { data, error: signUpError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName },
          emailRedirectTo: `${window.location.origin}/auth/callback?flow=signup`,
        },
      });
      if (signUpError) throw signUpError;

      // If Supabase has email confirmation ON, session will be null and the
      // user must verify via the emailed OTP. If OFF (local dev common), the
      // session lands immediately and we go straight to onboarding.
      if (data.session) {
        navigate("/onboarding", { replace: true });
      } else {
        navigate(`/auth/verify-otp?flow=signup&email=${encodeURIComponent(email)}`, {
          replace: true,
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to sign up");
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
          <div className="mb-6">
            <h2 className="text-2xl font-semibold mb-1">Create your page</h2>
            <p className="text-sm text-muted-foreground">
              Free forever — we only earn when you do.
            </p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-2">Your name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="input-field"
                placeholder="Ada Lovelace"
                required
                autoComplete="name"
              />
            </div>
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
                  placeholder="At least 8 characters"
                  required
                  autoComplete="new-password"
                  minLength={8}
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
              {loading ? "Creating your account…" : "Continue with email"}
            </button>
            <p className="text-xs text-muted-foreground text-center">
              By signing up you agree to Bookmi's Terms &amp; Privacy Policy.
            </p>
          </form>

          <div className="mt-6 text-center text-sm">
            Already have an account?{" "}
            <Link to="/auth/login" className="text-primary hover:underline font-medium">
              Log in
            </Link>
          </div>
        </div>
      </div>
    </AuthLayout>
  );
}
