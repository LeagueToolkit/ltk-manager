import { useLocation } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";

import { useReducedMotion } from "./useReducedMotion";

/**
 * Detects route changes and returns a CSS class name to apply
 * a brief enter transition. Does not force unmount/remount.
 */
export function usePageTransition() {
  const { pathname } = useLocation();
  const prevPathname = useRef(pathname);
  const [transitioning, setTransitioning] = useState(false);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    if (pathname !== prevPathname.current) {
      prevPathname.current = pathname;
      if (reducedMotion) return;

      setTransitioning(true);
    }
  }, [pathname, reducedMotion]);

  const onAnimationEnd = useCallback(() => {
    setTransitioning(false);
  }, []);

  return {
    className: transitioning ? "page-enter" : undefined,
    onAnimationEnd,
  };
}
