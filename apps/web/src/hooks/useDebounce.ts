import { useEffect, useState } from "react";

/**
 * Delays returning `value` until it hasn't changed for `delay` ms.
 * Used by the slug picker to throttle the availability check.
 */
export function useDebounce<T>(value: T, delay = 500): T {
  const [debounced, setDebounced] = useState<T>(value);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);

  return debounced;
}
