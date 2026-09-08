import { createContext, type ReactNode, use, useEffect, useState } from "react";
import { createPortal } from "react-dom";

/** The toolbar row a surface offers its documents, per surface. */
export const DocumentToolbarSlotContext = createContext<HTMLElement | null>(null);

export interface DocumentToolbarProps {
  /** This document is the one on screen. Only the active document's chrome shows. */
  active: boolean;
  children: ReactNode;
}

/**
 * A row of the active document's own chrome, across the top of its surface.
 *
 * The one home for what a document contributes: a search box, a stat, a Save,
 * the ways a file leaves the browser. It was a popover behind a `…` in the tab
 * strip once, which cost the strip nothing and cost every control on it the
 * chance of being found.
 *
 * The row takes no height at all until a document fills it, so a surface
 * showing a document without one looks as it did before this existed.
 *
 * A portal rather than a registry field, because a document's controls read
 * the edit state of the hooks in its own body. Mounting them a second time in
 * the row would give them a second, separate copy of it.
 *
 * A document mounted outside a surface finds no slot and draws nothing.
 */
export function DocumentToolbar({ active, children }: DocumentToolbarProps): ReactNode {
  const slot = use(DocumentToolbarSlotContext);
  if (!active || !slot) return null;

  return createPortal(children, slot);
}

/**
 * The width of the surface's toolbar row, or null before it is measured.
 *
 * A document lays its own chrome out against the pane it is in rather than the window,
 * because two surfaces split down the middle each hold half of it.
 */
export function useToolbarWidth(): number | null {
  const slot = use(DocumentToolbarSlotContext);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    if (!slot) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(slot);
    return () => observer.disconnect();
  }, [slot]);

  return width;
}
