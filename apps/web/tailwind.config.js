/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        // Qorelly primary — default is bright violet (matches qore-menu's tokens),
        // but `--primary` / `--primary-light` are rewritten at runtime by
        // `ThemeContext` from `profile.accentColor` so every `bg-primary` /
        // `text-primary` / `border-primary` / `bg-primary-light` re-tints
        // without touching the DOM tree.
        primary: {
          DEFAULT: "var(--primary, #7856FF)",
          foreground: "hsl(var(--primary-foreground))",
          hover: "var(--color-primary-hover, #6B4DE6)",
          light: "var(--primary-light, #F0ECFF)",
          dark: "var(--color-primary-dark, #5A3FD9)",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        // Pill for buttons, sharp everywhere else — Square/Revolut vibe qore-menu uses
        button: "9999px",
        card: "0px",
      },
      boxShadow: {
        medium: "0 4px 16px rgba(0, 0, 0, 0.08)",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
