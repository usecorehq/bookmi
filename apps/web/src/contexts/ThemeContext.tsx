import {
  createContext,
  useContext,
  useEffect,
  type ReactNode,
} from "react";
import { useAuth } from "@/contexts/AuthContext";
import { derivePrimaryLight } from "@/lib/color";

/** Default accent — matches the `#7856FF` fallback in tailwind.config.js. */
export const DEFAULT_ACCENT = "#7856FF";

export interface ThemeContextValue {
  /** Effective accent currently applied to `--primary`, in `#RRGGBB`. */
  accentColor: string;
  DEFAULT_ACCENT: string;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

/**
 * Reads `profile.accentColor` and writes it as `--primary` / `--primary-light`
 * on `:root` so every `bg-primary`, `text-primary`, `border-primary`, and
 * `bg-primary-light` picks it up at runtime.
 *
 * The source of truth is the auth profile — not localStorage — so the moment
 * `refreshProfile()` returns after a save in Profile → Identity, the whole
 * app re-tints without a reload.
 *
 * On unmount (or when the auth tree tears down at sign-out) we clear the
 * inline styles so the tailwind fallback (`var(--primary, #7856FF)`) kicks
 * back in — no leaked accent for the next signed-in host or for a customer
 * arriving at a public host page.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth();
  const accentColor = profile?.accentColor ?? DEFAULT_ACCENT;

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty("--primary", accentColor);
    root.style.setProperty("--primary-light", derivePrimaryLight(accentColor));
    return () => {
      root.style.removeProperty("--primary");
      root.style.removeProperty("--primary-light");
    };
  }, [accentColor]);

  return (
    <ThemeContext.Provider value={{ accentColor, DEFAULT_ACCENT }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
