import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { NO_OVERSCROLL, useZoomedPx } from "@/hooks";
import type { DeclarationsLayer } from "@/lib/tauri";

import { useReadOnlyTreeNav } from "../../hooks";
import type { OpenIntent } from "../../palette/utils/types";
import {
  ancestorIds,
  flattenOutline,
  isBranch,
  type OutlineNode,
  type OutlineShape,
} from "../utils/outlineTree";
import { DeclarationsTreeRow } from "./DeclarationsTreeRow";

/* Every read-only tree of the editor scans alike. */
const ROW_HEIGHT = 24;

/** A request to select and show one item, told apart from the last by its token. */
export interface OutlineReveal {
  itemId: string;
  token: number;
}

interface DeclarationsTreeProps {
  layers: readonly DeclarationsLayer[];
  shape: OutlineShape;
  ariaLabel: string;
  /** What `Enter`, a click on a leaf, or a row's own action does. */
  onOpen: (node: OutlineNode, intent: OpenIntent) => void;
  /** Whether a click on a branch opens it rather than folding it. */
  openBranches: boolean;
  reveal?: OutlineReveal | null;
  onRevealed?: (token: number) => void;
  /** The row the keyboard sits on, as it moves. */
  onSelect?: (node: OutlineNode | null) => void;
}

/**
 * A read-only virtualized tree over a project's declarations: layer, module, entry, key.
 *
 * Every branch starts open. A reveal opens the branches above its item, then selects and
 * scrolls to it.
 */
export function DeclarationsTree({
  layers,
  shape,
  ariaLabel,
  onOpen,
  openBranches,
  reveal = null,
  onRevealed,
  onSelect,
}: DeclarationsTreeProps) {
  const [shut, setShut] = useState<ReadonlySet<string>>(() => new Set());
  const isShut = useCallback((id: string) => shut.has(id), [shut]);
  const rows = useMemo(() => flattenOutline(layers, isShut, shape), [layers, isShut, shape]);

  const toggle = useCallback((node: OutlineNode) => {
    setShut((held) => {
      const next = new Set(held);
      if (!next.delete(node.id)) next.add(node.id);
      return next;
    });
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomed = useZoomedPx();
  const rowHeight = zoomed(ROW_HEIGHT);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: (index) => rows[index]!.node.id,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoomed]);

  const { focusedIndex, setFocusedIndex, moveFocus, handleKeyDown } = useReadOnlyTreeNav({
    rows,
    isExpanded: (node: OutlineNode) => isBranch(node, shape) && !shut.has(node.id),
    onToggle: toggle,
    onOpen,
    expandable: (node: OutlineNode) => isBranch(node, shape),
    activation: (node: OutlineNode) => {
      if (openBranches || !isBranch(node, shape)) return "open";
      return "toggle";
    },
    virtualizer,
    scrollElementRef: scrollRef,
  });

  const selected = rows[focusedIndex]?.node ?? null;
  useEffect(() => {
    onSelect?.(selected);
  }, [selected, onSelect]);

  /* The branches open first, and the row is looked up on the render that draws it. */
  useEffect(() => {
    if (!reveal) return;

    const closed = ancestorIds(reveal.itemId).filter((id) => shut.has(id));
    if (closed.length > 0) {
      setShut((held) => {
        const next = new Set(held);
        for (const id of closed) next.delete(id);
        return next;
      });
      return;
    }

    const at = rows.findIndex((row) => row.node.id === reveal.itemId);
    if (at >= 0) moveFocus(at);
    onRevealed?.(reveal.token);
  }, [reveal, rows, shut, moveFocus, onRevealed]);

  return (
    <div
      data-ui="DeclarationsTree"
      ref={scrollRef}
      className="flex-1 overflow-auto font-mono text-xs outline-none scrollbar-md scrollbar-track"
      role="tree"
      aria-label={ariaLabel}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      {...NO_OVERSCROLL}
    >
      <div
        role="presentation"
        data-tree-rows=""
        className="relative my-1 w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index]!;
          const isSelected = virtualRow.index === focusedIndex;

          return (
            <div
              key={virtualRow.key}
              role="presentation"
              className="absolute inset-x-0"
              style={{ transform: `translateY(${virtualRow.start}px)` }}
            >
              <DeclarationsTreeRow
                node={row.node}
                depth={row.depth}
                branch={isBranch(row.node, shape)}
                isExpanded={!shut.has(row.node.id)}
                isSelected={isSelected}
                openBranches={openBranches}
                onToggle={toggle}
                onSelect={setFocusedIndex}
                onOpen={onOpen}
                height={rowHeight}
                rowIndex={virtualRow.index}
                tabIndex={isSelected ? 0 : -1}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
