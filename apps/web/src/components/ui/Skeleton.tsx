import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

/**
 * A single shimmer bar/block. Compose these into row-shaped placeholders
 * that mirror the real content's layout (name line, subtitle line,
 * right-aligned amount + pill, etc.) rather than a generic spinner —
 * pages render `Array.from({ length: 5 })` of their own row-skeleton
 * component while the underlying query is `isPending`.
 */
export function Skeleton({
  className,
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  return <div className={cn("animate-pulse bg-gray-200 rounded", className)} style={style} />;
}
