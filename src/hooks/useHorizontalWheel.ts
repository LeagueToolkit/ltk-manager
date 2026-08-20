import { type RefObject, useEffect } from "react";

/**
 * Lets a plain wheel scroll a strip that only moves sideways.
 *
 * A vertical wheel does nothing over a horizontal container, so whatever sits
 * past its edge is out of reach without holding shift. Anything that already
 * carries its own meaning is left alone: a wheel reporting horizontal movement,
 * shift, which the browser already turns sideways, and ctrl, which is a zoom.
 *
 * The listener is bound by hand because React registers `wheel` passively, and
 * a passive listener cannot take the event off the browser.
 */
export function useHorizontalWheel(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const onWheel = (event: WheelEvent) => {
      if (event.ctrlKey || event.shiftKey || event.deltaX !== 0) return;
      if (el.scrollWidth <= el.clientWidth) return;

      const before = el.scrollLeft;
      /* Instant against the app's own `scroll-behavior: smooth`, which would
         otherwise animate every notch and leave the strip trailing the wheel. */
      el.scrollBy({ left: event.deltaY, behavior: "instant" });

      // Past either end the wheel is left to whatever sits above the strip.
      if (el.scrollLeft !== before) event.preventDefault();
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [ref]);
}
