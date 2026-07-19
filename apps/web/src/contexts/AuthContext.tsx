import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { apiFetch } from "@/lib/api";
import type { HostProfile, HostWallet } from "@bookmi/shared-types";

type ProfileWithWallet = HostProfile & { wallet: HostWallet | null };

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  profile: ProfileWithWallet | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

/**
 * Provider order:
 *   1. Supabase session hydrates (from localStorage or the incoming URL PKCE code)
 *   2. If a session exists, we fetch the host profile from the API
 *   3. `loading` stays true until step 2 completes so guards don't misclassify
 *      a signed-in-but-not-onboarded user as unauthenticated.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<ProfileWithWallet | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = useCallback(async (): Promise<ProfileWithWallet | null> => {
    try {
      const res = await apiFetch<{ profile: ProfileWithWallet | null }>("/hosts/me/profile");
      return res.profile;
    } catch (err) {
      // 404 = no profile yet (fresh signup); other errors we treat the same
      // for guard purposes and let the network / retry surface elsewhere.
      console.warn("[auth] profile fetch failed", err);
      return null;
    }
  }, []);

  const refreshProfile = useCallback(async () => {
    const p = await fetchProfile();
    setProfile(p);
  }, [fetchProfile]);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      if (data.session) {
        const p = await fetchProfile();
        if (mounted) setProfile(p);
      }
      if (mounted) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      if (!mounted) return;
      setSession(next);
      if (next) {
        const p = await fetchProfile();
        if (mounted) setProfile(p);
      } else {
        setProfile(null);
      }
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, [fetchProfile]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setProfile(null);
  };

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        profile,
        loading,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
