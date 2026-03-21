import { useEffect, useState } from "react";

import { useDisplayStore } from "@/stores";

const MEDIA_QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const reduceMotion = useDisplayStore((s) => s.reduceMotion);
  const [osPrefers, setOsPrefers] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(MEDIA_QUERY).matches;
  });

  useEffect(() => {
    const mql = window.matchMedia(MEDIA_QUERY);
    const handler = (e: MediaQueryListEvent) => setOsPrefers(e.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  if (reduceMotion === "on") return true;
  if (reduceMotion === "off") return false;
  return osPrefers;
}
