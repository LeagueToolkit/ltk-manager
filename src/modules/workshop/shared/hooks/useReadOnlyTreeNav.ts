import type { Virtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, type RefObject, useCallback, useEffect, useState } from "react";

import type { OpenIntent } from "../../palette/utils/types";

/** What a row's node answers a key with: the tab it opens, or the branch it folds. */
export type NodeActivation = "open" | "toggle" | "none";

/** A row of a flattened tree: its node, and how deep the node sits. */
interface DepthRow<Node> {
  readonly node: Node;
  readonly depth: number;
}

interface UseReadOnlyTreeNavParams<Node, Row extends DepthRow<Node>> {
  rows: readonly Row[];
  isExpanded: (node: Node) => boolean;
  onToggle: (node: Node) => void;
  /** The keyboard route to what a click on a row does. */
  onOpen: (node: Node, intent: OpenIntent) => void;
  /** Whether the node has children to fold. */
  expandable: (node: Node) => boolean;
  /** What `Enter` on the node does. */
  activation: (node: Node) => NodeActivation;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  scrollElementRef: RefObject<HTMLDivElement | null>;
  /** Called with the row a key moved focus to. A tree without it only moves focus. */
  onKeyMove?: (node: Node) => void;
}

interface UseReadOnlyTreeNavReturn {
  focusedIndex: number;
  setFocusedIndex: (at: number) => void;
  /** Focus the row at `index`, scrolled into view. */
  moveFocus: (index: number) => void;
  handleKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
}

/**
 * Roving-tabindex keyboard navigation for a read-only tree of the editor.
 *
 * The source tree's key rules over any row model: `expandable` and `activation` are what
 * the caller's node type answers with. A node that both opens and folds opens on `Enter`
 * and expands from `ArrowRight` alone, the rule a click obeys.
 */
export function useReadOnlyTreeNav<Node, Row extends DepthRow<Node>>({
  rows,
  isExpanded,
  onToggle,
  onOpen,
  expandable,
  activation,
  virtualizer,
  scrollElementRef,
  onKeyMove,
}: UseReadOnlyTreeNavParams<Node, Row>): UseReadOnlyTreeNavReturn {
  const [focusedIndex, setFocusedIndex] = useState(0);

  useEffect(() => {
    setFocusedIndex((at) => (rows.length === 0 ? 0 : Math.max(0, Math.min(at, rows.length - 1))));
  }, [rows.length]);

  const moveFocus = useCallback(
    (nextIndex: number) => {
      const clamped = Math.max(0, Math.min(nextIndex, rows.length - 1));
      setFocusedIndex(clamped);
      virtualizer.scrollToIndex(clamped, { align: "auto", behavior: "auto" });
      requestAnimationFrame(() => {
        /* Scoped to the rows themselves: the pinned band carries a second copy of an
           ancestor row under the same index, and it is not the one to focus. */
        const el = scrollElementRef.current?.querySelector<HTMLElement>(
          `[data-tree-rows] [data-treeitem-index="${clamped}"]`,
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

      const keyMove = (index: number) => {
        moveFocus(index);
        const target = rows[Math.max(0, Math.min(index, rows.length - 1))];
        if (target) onKeyMove?.(target.node);
      };

      switch (e.key) {
        case "Enter": {
          const does = activation(node);
          if (does === "open") {
            e.preventDefault();
            onOpen(node, e.ctrlKey || e.metaKey ? "beside" : "default");
          } else if (does === "toggle") {
            e.preventDefault();
            onToggle(node);
          }
          return;
        }
        case "ArrowDown":
          e.preventDefault();
          keyMove(focusedIndex + 1);
          return;
        case "ArrowUp":
          e.preventDefault();
          keyMove(focusedIndex - 1);
          return;
        case "Home":
          e.preventDefault();
          keyMove(0);
          return;
        case "End":
          e.preventDefault();
          keyMove(rows.length - 1);
          return;
        case "ArrowRight":
          if (expandable(node)) {
            e.preventDefault();
            if (!isExpanded(node)) onToggle(node);
            else keyMove(focusedIndex + 1);
          }
          return;
        case "ArrowLeft":
          if (expandable(node) && isExpanded(node)) {
            e.preventDefault();
            onToggle(node);
          } else if (row.depth > 0) {
            e.preventDefault();
            for (let at = focusedIndex - 1; at >= 0; at -= 1) {
              if (rows[at]!.depth < row.depth) {
                keyMove(at);
                break;
              }
            }
          }
          return;
      }
    },
    [
      rows,
      focusedIndex,
      isExpanded,
      onToggle,
      onOpen,
      expandable,
      activation,
      moveFocus,
      onKeyMove,
    ],
  );

  return { focusedIndex, setFocusedIndex, moveFocus, handleKeyDown };
}
