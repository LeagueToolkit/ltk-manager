import type { Virtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, type RefObject, useCallback, useEffect, useState } from "react";

import type { FlatTreeRow } from "../utils/contentTree";

interface UseContentTreeNavParams {
  rows: readonly FlatTreeRow[];
  /** Directories the user shut. Anything absent is open. */
  collapsed: ReadonlySet<string>;
  onToggle: (path: string) => void;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  scrollElementRef: RefObject<HTMLDivElement | null>;
}

interface UseContentTreeNavReturn {
  focusedIndex: number;
  setFocusedIndex: (i: number) => void;
  handleKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Roving-tabindex keyboard navigation for a virtualized file tree.
 *
 * Owns the "which row is currently selected" index, scrolls it into view via
 * the virtualizer, and moves DOM focus to the row element identified by
 * `data-treeitem-index`. ArrowLeft/Right also handle expand/collapse and
 * jump-to-parent, so rows don't need to know about the rest of the tree.
 */
export function useContentTreeNav({
  rows,
  collapsed,
  onToggle,
  virtualizer,
  scrollElementRef,
}: UseContentTreeNavParams): UseContentTreeNavReturn {
  const [focusedIndex, setFocusedIndex] = useState(0);

  useEffect(() => {
    setFocusedIndex((i) => (rows.length === 0 ? 0 : Math.max(0, Math.min(i, rows.length - 1))));
  }, [rows.length]);

  const moveFocus = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(nextIndex, rows.length - 1));
      setFocusedIndex(clamped);
      virtualizer.scrollToIndex(clamped, { align: "auto", behavior: "auto" });
      requestAnimationFrame(() => {
        const el = scrollElementRef.current?.querySelector<HTMLElement>(
          `[data-treeitem-index="${clamped}"]`,
        );
        el?.focus();
      });
    },
    [rows.length, virtualizer, scrollElementRef],
  );

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      const row = rows[focusedIndex];
      if (!row) return;
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          moveFocus(focusedIndex + 1);
          return;
        case "ArrowUp":
          e.preventDefault();
          moveFocus(focusedIndex - 1);
          return;
        case "Home":
          e.preventDefault();
          moveFocus(0);
          return;
        case "End":
          e.preventDefault();
          moveFocus(rows.length - 1);
          return;
        case "ArrowRight":
          if (row.node.type === "dir") {
            e.preventDefault();
            if (collapsed.has(row.node.path)) onToggle(row.node.path);
            else moveFocus(focusedIndex + 1);
          }
          return;
        case "ArrowLeft":
          if (row.node.type === "dir" && !collapsed.has(row.node.path)) {
            e.preventDefault();
            onToggle(row.node.path);
          } else if (row.depth > 0) {
            e.preventDefault();
            for (let i = focusedIndex - 1; i >= 0; i--) {
              if (rows[i]!.depth < row.depth) {
                moveFocus(i);
                break;
              }
            }
          }
          return;
      }
    },
    [rows, focusedIndex, collapsed, onToggle, moveFocus],
  );

  return { focusedIndex, setFocusedIndex, handleKeyDown };
}
