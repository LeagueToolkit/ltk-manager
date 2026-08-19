import { createContext, type ReactNode, use } from "react";
import { createPortal } from "react-dom";

/** The tab strip element a surface offers its documents, per surface. */
export const DocumentActionsSlotContext = createContext<HTMLElement | null>(null);

export interface DocumentActionsProps {
  /** This document is the one on screen. Only the active document's chrome shows. */
  active: boolean;
  children: ReactNode;
}

/**
 * Chrome the active document contributes to its leaf's tab strip.
 *
 * A portal rather than a registry field, because a document's controls read the
 * edit state of the hooks in its own body. Mounting them a second time in the
 * strip would give them a second, separate copy of it.
 *
 * A document mounted outside a surface finds no slot and draws nothing.
 */
export function DocumentActions({ active, children }: DocumentActionsProps): ReactNode {
  const slot = use(DocumentActionsSlotContext);
  if (!active || !slot) return null;

  return createPortal(children, slot);
}
