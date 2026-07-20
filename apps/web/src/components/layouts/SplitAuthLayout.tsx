import { useEffect, useState } from "react";
import type { ReactNode } from "react";

const SLIDES = [
  "/images/login/loginimg.jpg",
  "/images/login/loginimg1.jpg",
  "/images/login/loginimg2.jpg",
];
const SLIDE_INTERVAL = 5000;

/**
 * Split-screen auth shell — 35% form column on a solid white background,
 * 65% full-bleed image slider with a floating attribution card
 * bottom-right. Used by Login + Signup. Other auth flows stay on AuthLayout.
 *
 * Form column is center-aligned both axes; right column hidden on < lg.
 */
export function SplitAuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen grid lg:grid-cols-[35%_65%]">
      <div className="flex flex-col items-center justify-center bg-white px-6 py-12">
        <div className="w-full max-w-md">{children}</div>
      </div>
      <HeroSlider />
    </div>
  );
}

function HeroSlider() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SLIDES.length);
    }, SLIDE_INTERVAL);
    return () => clearInterval(id);
  }, []);

  return (
    <aside className="relative hidden lg:block overflow-hidden bg-primary">
      <div className="absolute inset-0">
        {SLIDES.map((src, i) => (
          <img
            key={src}
            src={src}
            alt=""
            aria-hidden={i !== index}
            className="absolute inset-0 h-full w-full object-cover transition-opacity duration-700 ease-out"
            style={{ opacity: i === index ? 1 : 0 }}
          />
        ))}
      </div>

      {/* Dot indicators — bottom-center, above the attribution card */}
      <div className="absolute bottom-8 left-1/2 z-10 -translate-x-1/2 flex items-center gap-2">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            type="button"
            aria-label={`Go to slide ${i + 1}`}
            onClick={() => setIndex(i)}
            className="h-1.5 rounded-full bg-white transition-all duration-300"
            style={{ width: i === index ? 24 : 8, opacity: i === index ? 1 : 0.5 }}
          />
        ))}
      </div>

      {/* Attribution card — bottom right */}
      <div className="absolute bottom-6 right-6 z-10 flex items-center gap-3 rounded-button bg-white px-4 py-3 shadow-medium">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary-light text-sm font-semibold text-primary">
          Q
        </span>
        <div className="leading-tight">
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Curated by
          </div>
          <div className="text-sm font-medium text-foreground">Qorelly Studio</div>
        </div>
      </div>
    </aside>
  );
}

export default SplitAuthLayout;
