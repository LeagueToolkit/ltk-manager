import type { Virtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, type RefObject, useCallback, useEffect, useState } from "react";

import type { SourceDirNode, SourceRow, SourceTreeNode } from "./sourceIndex";

function expandable(node: SourceTreeNode): node is SourceDirNode {
  return node.type === "dir";
}

interface UseSourceTreeNavParams {
  rows: readonly SourceRow[];
  isExpanded: (node: SourceDirNode) => boolean;
  onToggle: (node: SourceDirNode) => void;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  scrollElementRef: RefObject<HTMLDivElement | null>;
}

interface UseSourceTreeNavReturn {
  focusedIndex: number;
  setFocusedIndex: (i: number) => void;
  handleKeyDown: (e: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Roving-tabindex keyboard navigation for the virtualized source tree.
 *
 * The same key rules as the layer file tree's `useContentTreeNav`, retargeted
 * at the source row model.
 */
export function useSourceTreeNav({
  rows,
  isExpanded,
  onToggle,
  virtualizer,
  scrollElementRef,
}: UseSourceTreeNavParams): UseSourceTreeNavReturn {
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
      const node = row.node;
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
          if (expandable(node)) {
            e.preventDefault();
            if (!isExpanded(node)) onToggle(node);
            else moveFocus(focusedIndex + 1);
          }
          return;
        case "ArrowLeft":
          if (expandable(node) && isExpanded(node)) {
            e.preventDefault();
            onToggle(node);
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
    [rows, focusedIndex, isExpanded, onToggle, moveFocus],
  );

  return { focusedIndex, setFocusedIndex, handleKeyDown };
}
