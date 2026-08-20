import { createContext, type ReactNode, use } from "react";
import { createPortal } from "react-dom";

/** The tab strip element a surface offers its documents, per surface. */
export const DocumentActionsSlotContext = createContext<HTMLElement | null>(null);

/** The toolbar row a surface offers its documents, per surface. */
export const DocumentToolbarSlotContext = createContext<HTMLElement | null>(null);

export interface DocumentActionsProps {
  /** This document is the one on screen. Only the active document's chrome shows. */
  active: boolean;
  children: ReactNode;
}

/**
 * Compact chrome the active document contributes to its leaf's tab strip.
 *
 * For controls that read as a couple of icons - a toggle, a zoom. The strip
 * collects them behind one button, so anything that wants room of its own goes
 * in {@link DocumentToolbar} instead.
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

export type DocumentToolbarProps = DocumentActionsProps;

/**
 * A row of the active document's own chrome, across the top of its surface.
 *
 * Where a search box belongs, and anything else that wants the full width. The
 * row takes no height at all until a document fills it, so a surface showing a
 * document without one looks as it did before this existed.
 *
 * The same portal as {@link DocumentActions}, for the same reason.
 */
export function DocumentToolbar({ active, children }: DocumentToolbarProps): ReactNode {
  const slot = use(DocumentToolbarSlotContext);
  if (!active || !slot) return null;

  return createPortal(children, slot);
}
