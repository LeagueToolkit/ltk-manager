import { useVirtualizer } from "@tanstack/react-virtual";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useMemo, useRef, useState } from "react";

import { ContextMenu } from "@/components";
import { NO_OVERSCROLL } from "@/hooks/useOverscrollSpring";

import {
  flattenSourceTree,
  type SourceDirNode,
  type SourceFileNode,
  type SourceTreeNode,
} from "./sourceIndex";
import { SourceTreeContextMenu } from "./SourceTreeContextMenu";
import { SourceTreeRow } from "./SourceTreeRow";
import { useSourceTreeNav } from "./useSourceTreeNav";

/* The layer file tree's fixed row height, so the two trees scan alike. */
const ROW_HEIGHT = 24;

interface SourceTreeProps {
  nodes: readonly SourceTreeNode[];
  ariaLabel: string;
  isExpanded: (node: SourceDirNode) => boolean;
  onToggle: (node: SourceDirNode) => void;
  /** A double click on a file row, or its Open menu item. */
  onOpen?: (node: SourceFileNode) => void;
}

/** A read-only virtualized tree over source nodes, from any source index. */
export function SourceTree({ nodes, ariaLabel, isExpanded, onToggle, onOpen }: SourceTreeProps) {
  const rows = useMemo(() => flattenSourceTree(nodes, isExpanded), [nodes, isExpanded]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => rows[index]!.node.id,
  });

  const { focusedIndex, setFocusedIndex, handleKeyDown } = useSourceTreeNav({
    rows,
    isExpanded,
    onToggle,
    onOpen,
    virtualizer,
    scrollElementRef: scrollRef,
  });

  /* One menu for the whole tree, pointed at the row the event came from, the
     same scheme the layer file tree uses. */
  const [menuNode, setMenuNode] = useState<SourceTreeNode | null>(null);

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-treeitem-index]");
    const index = Number(row?.dataset.treeitemIndex);
    setMenuNode(Number.isInteger(index) ? (rows[index]?.node ?? null) : null);
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        data-ui="SourceTree"
        ref={scrollRef}
        className="flex-1 overflow-auto py-1 font-mono text-xs outline-none"
        role="tree"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        {...NO_OVERSCROLL}
      >
        <div
          role="presentation"
          className="relative w-full"
          style={{ height: `${virtualizer.getTotalSize()}px` }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const row = rows[virtualRow.index]!;
            const node = row.node;
            const expanded = node.type === "dir" && isExpanded(node);
            const isSelected = virtualRow.index === focusedIndex;
            return (
              <div
                key={virtualRow.key}
                role="presentation"
                className="absolute inset-x-0"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <SourceTreeRow
                  node={node}
                  depth={row.depth}
                  isExpanded={expanded}
                  isSelected={isSelected}
                  onToggle={onToggle}
                  onSelect={setFocusedIndex}
                  onOpen={onOpen}
                  height={ROW_HEIGHT}
                  rowIndex={virtualRow.index}
                  tabIndex={isSelected ? 0 : -1}
                />
              </div>
            );
          })}
        </div>
      </ContextMenu.Trigger>

      <SourceTreeContextMenu node={menuNode} onOpen={onOpen} />
    </ContextMenu.Root>
  );
}
