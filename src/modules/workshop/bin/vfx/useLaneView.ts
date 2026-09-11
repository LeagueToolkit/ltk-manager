import { type RefObject, useEffect, useRef, useState } from "react";

import { fitted, panned, timeAt, type TimeWindow, zoomed } from "./laneModel";

/** What one wheel notch does to the view: a fifth in or out, or a tenth of it sideways. */
const ZOOM_NOTCH = 1.2;
const PAN_NOTCH = 0.1;

/** The lanes' visible time window, fitted to `span` until a wheel gesture zooms or pans it. */
export function useLaneView(
  span: number,
  body: RefObject<HTMLDivElement | null>,
  width: number,
): { view: TimeWindow; refit: () => void } {
  const [view, setWindow] = useState<TimeWindow>(() => fitted(span));
  const touched = useRef(false);
  useEffect(() => {
    if (!touched.current) setWindow(fitted(span));
  }, [span]);

  /* Ctrl and the wheel zoom about the pointer, Shift and the wheel pan, and a bare wheel is
     the pane's own scroll. A native listener, because React's is passive. */
  useEffect(() => {
    const element = body.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.shiftKey) return;
      event.preventDefault();
      touched.current = true;
      const track = element.querySelector<HTMLElement>("[data-track]");
      const left = track?.getBoundingClientRect().left ?? 0;
      setWindow((held) => {
        if (event.ctrlKey) {
          const factor = event.deltaY > 0 ? ZOOM_NOTCH : 1 / ZOOM_NOTCH;
          return zoomed(held, timeAt(held, width, event.clientX - left), factor, span);
        }
        const notch = (event.deltaY || event.deltaX) > 0 ? 1 : -1;
        return panned(held, (held.to - held.from) * PAN_NOTCH * notch, span);
      });
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [body, span, width]);

  const refit = () => {
    touched.current = false;
    setWindow(fitted(span));
  };

  return { view, refit };
}
