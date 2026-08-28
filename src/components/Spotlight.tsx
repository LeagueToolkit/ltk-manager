import { useEffect, useState } from "react";
import { twMerge } from "tailwind-merge";

/**
 * The element a spotlight is cut around, looked up rather than held.
 *
 * A function because the element standing for a thing can change while the
 * spotlight is open - a virtualized row is re-created as the list scrolls, and
 * a pinned one has a second copy of itself.
 */
export type SpotlightAnchor = () => HTMLElement | null;

interface SpotlightProps {
  anchor: SpotlightAnchor;
}

/**
 * A modal scrim with one element cut out of it.
 *
 * Four strips around the anchor rather than one sheet over everything: a
 * popover that points at something and then blurs that thing away has argued
 * against itself. What the popover is talking about stays legible beside it,
 * and the ring is what keeps the gap in the dim from reading as a seam.
 *
 * Goes inside a modal `Popover.Backdrop`, which supplies the fixed inset and
 * the fade.
 */
export function Spotlight({ anchor }: SpotlightProps) {
  const rect = useAnchorRect(anchor);
  const dim = "absolute bg-scrim backdrop-blur-sm";

  if (!rect) return <div className={twMerge(dim, "inset-0")} />;

  return (
    <>
      <div className={twMerge(dim, "inset-x-0 top-0")} style={{ height: rect.top }} />
      <div className={twMerge(dim, "inset-x-0 bottom-0")} style={{ top: rect.bottom }} />
      <div
        className={twMerge(dim, "left-0")}
        style={{ top: rect.top, height: rect.height, width: rect.left }}
      />
      <div
        className={twMerge(dim, "right-0")}
        style={{ top: rect.top, height: rect.height, left: rect.right }}
      />
      <div
        className="absolute rounded-sm ring-1 ring-accent-500/50"
        style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
      />
    </>
  );
}

/** The anchored element's box, remeasured when the window moves under it. */
function useAnchorRect(anchor: SpotlightAnchor): DOMRect | null {
  const [rect, setRect] = useState<DOMRect | null>(() => anchor()?.getBoundingClientRect() ?? null);

  /* A modal popover locks the page scroll, so a resize is the only thing left
     that can move the anchor after this opens. */
  useEffect(() => {
    const measure = () => setRect(anchor()?.getBoundingClientRect() ?? null);
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [anchor]);

  return rect;
}
