/**
 * Tiny colour helpers for the runtime theming layer.
 *
 * `derivePrimaryLight` turns any user-picked accent (hex) into a very pale
 * tint of the same hue that's safe to use as a background behind the accent
 * itself — mirroring the visual role qore-menu's `--color-primary-light` plays.
 * The trick is to keep the hue, dampen saturation, and push lightness up to
 * ~96 % — HSL makes that a two-line transform.
 *
 * Anything not a valid hex falls back to `#F0ECFF` (bookmi's default light).
 */

const DEFAULT_LIGHT = "#F0ECFF";

const HEX_RE = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

function normaliseHex(hex: string): string | null {
  if (!HEX_RE.test(hex)) return null;
  const clean = hex.replace(/^#/, "");
  return clean.length === 3
    ? clean.split("").map((c) => c + c).join("")
    : clean;
}

export function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const full = normaliseHex(hex);
  if (!full) return null;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return { h, s: s * 100, l: l * 100 };
}

export function hslToHex(h: number, s: number, l: number): string {
  const S = s / 100;
  const L = l / 100;
  const a = S * Math.min(L, 1 - L);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    const c = L - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

/** Pale tint of the accent, suitable for `bg-primary-light` backgrounds. */
export function derivePrimaryLight(hex: string): string {
  const hsl = hexToHsl(hex);
  if (!hsl) return DEFAULT_LIGHT;
  // Keep the hue, dampen saturation so grays/near-blacks don't turn cold,
  // and float lightness to ~96 % — the same visual weight #F0ECFF has for #7856FF.
  const s = Math.min(hsl.s, 60);
  return hslToHex(hsl.h, s, 96);
}
