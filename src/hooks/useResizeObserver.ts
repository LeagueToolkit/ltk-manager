import { type RefCallback, useCallback, useLayoutEffect, useRef } from "react";

/**
 * Watches an element for a size change, through the ref this returns.
 *
 * `onResize` runs as the element attaches and on every change after it.
 * See [ResizeObserver](https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver).
 */
export function useResizeObserver<T extends Element>(
  onResize: (element: T) => void,
): RefCallback<T> {
  const latest = useRef(onResize);

  useLayoutEffect(() => {
    latest.current = onResize;
  });

  return useCallback((element: T | null) => {
    if (!element) return;

    const measure = () => latest.current(element);

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
}
