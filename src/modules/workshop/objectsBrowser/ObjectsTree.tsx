import { useVirtualizer } from "@tanstack/react-virtual";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContextMenu } from "@/components";
import { NO_OVERSCROLL, useZoomedPx } from "@/hooks";

import { TreeStickyBand } from "../components/TreeStickyBand";
import { useReadOnlyTreeNav, useStickyTreeRows } from "../hooks";
import type { OpenIntent } from "../palette/types";
import { keepScrollTop, keptScrollTop, type ObjectsReveal } from "../state";
import { ObjectsContextMenu } from "./ObjectsContextMenu";
import { ObjectsTreeRow } from "./ObjectsTreeRow";
import {
  activation,
  expandable,
  flattenObjectTree,
  type ObjectTreeNode,
  type ObjectTreeRow,
} from "./objectTree";

/* The source tree's fixed row height. The two browsers scan alike. */
const ROW_HEIGHT = 24;

/* The `py-1` above the first row, which the pinned band reads the scroll past. */
const CONTENT_TOP = 4;

interface ObjectsTreeProps {
  nodes: readonly ObjectTreeNode[];
  ariaLabel: string;
  isExpanded: (node: ObjectTreeNode) => boolean;
  onToggle: (node: ObjectTreeNode) => void;
  /** A click on an object row, or its Open menu item. */
  onOpen: (node: ObjectTreeNode, intent: OpenIntent) => void;
  /** Names this tree's scroll to the browser store. Absent starts at the top. */
  scrollKey?: string;
  /** The row to expand to, focus and scroll to. A listing in flight defers it. */
  reveal?: ObjectsReveal | null;
  /** The reveal with `token` landed, or has no row to land on. */
  onRevealed?: (token: number) => void;
}

/** A read-only virtualized tree over the object nodes, browse and find alike. */
export function ObjectsTree({
  nodes,
  ariaLabel,
  isExpanded,
  onToggle,
  onOpen,
  scrollKey,
  reveal = null,
  onRevealed,
}: ObjectsTreeProps) {
  const rows = useMemo(() => flattenObjectTree(nodes, isExpanded), [nodes, isExpanded]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [initialOffset] = useState(() => (scrollKey ? keptScrollTop(scrollKey) : 0));

  /* The live element rather than one captured at mount. Where it ended up is what is
     read. */
  useEffect(() => {
    if (!scrollKey) return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => keepScrollTop(scrollKey, scrollRef.current?.scrollTop ?? 0);
  }, [scrollKey]);

  const isOpenBranch = useCallback(
    (row: ObjectTreeRow) =>
      (row.node.type === "prefix" || row.node.type === "object") && isExpanded(row.node),
    [isExpanded],
  );

  const zoomed = useZoomedPx();
  const rowHeight = zoomed(ROW_HEIGHT);

  const { sticky, height: stickyHeight } = useStickyTreeRows({
    rows,
    scrollElementRef: scrollRef,
    rowHeight,
    offsetTop: CONTENT_TOP,
    isOpenBranch,
  });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: (index) => rows[index]!.node.id,
    initialOffset,
    scrollPaddingStart: stickyHeight,
  });

  /* Sizes cached at the old zoom outlive a change to it: `estimateSize` is not
     one of the inputs the measurement memo watches. */
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoomed]);

  const { focusedIndex, setFocusedIndex, moveFocus, handleKeyDown } = useReadOnlyTreeNav({
    rows,
    isExpanded,
    onToggle,
    onOpen,
    expandable,
    activation: (node) => activation(node, "row"),
    virtualizer,
    scrollElementRef: scrollRef,
  });

  /* The row lands with its listing, at its first appearance in `rows`. A path no row
     carries settles with the last loading row. */
  const revealed = useRef<number | null>(null);
  useEffect(() => {
    if (reveal === null || revealed.current === reveal.token) return;
    const index = rows.findIndex((row) => row.node.id === reveal.path);
    if (index < 0 && rows.some((row) => row.node.type === "loading")) return;
    revealed.current = reveal.token;
    if (index >= 0) moveFocus(index);
    onRevealed?.(reveal.token);
  }, [reveal, rows, onRevealed, moveFocus]);

  /* A pinned row answers a click by going to the row it stands for. Collapsing
     from up there would shut a prefix the user cannot see the extent of. */
  const revealRow = useCallback(
    (index: number) => {
      setFocusedIndex(index);
      virtualizer.scrollToIndex(index, { align: "start" });
    },
    [setFocusedIndex, virtualizer],
  );

  /* One menu for the whole tree, pointed at the row the event came from. */
  const [menuNode, setMenuNode] = useState<ObjectTreeNode | null>(null);

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-treeitem-index]");
    const index = Number(row?.dataset.treeitemIndex);
    setMenuNode(Number.isInteger(index) ? (rows[index]?.node ?? null) : null);
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        data-ui="ObjectsTree"
        ref={scrollRef}
        className="flex-1 overflow-auto font-mono text-xs outline-none scrollbar-md scrollbar-track"
        role="tree"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        {...NO_OVERSCROLL}
      >
        <div className="py-1">
          <TreeStickyBand height={stickyHeight}>
            {sticky.map((pin, slot) => (
              <div
                key={pin.row.node.id}
                role="presentation"
                className="absolute inset-x-0 bg-surface-950"
                style={{ top: `${pin.top}px`, zIndex: sticky.length - slot }}
              >
                <ObjectsTreeRow
                  node={pin.row.node}
                  depth={pin.row.depth}
                  isExpanded
                  isSelected={pin.index === focusedIndex}
                  onToggle={() => revealRow(pin.index)}
                  onSelect={setFocusedIndex}
                  onOpen={() => revealRow(pin.index)}
                  height={rowHeight}
                  rowIndex={pin.index}
                  tabIndex={-1}
                />
              </div>
            ))}
          </TreeStickyBand>

          <div
            role="presentation"
            data-tree-rows=""
            className="relative w-full"
            style={{ height: `${virtualizer.getTotalSize()}px` }}
          >
            {virtualizer.getVirtualItems().map((virtualRow) => {
              const row = rows[virtualRow.index]!;
              const node = row.node;
              const expanded =
                (node.type === "prefix" || node.type === "object") && isExpanded(node);
              const isSelected = virtualRow.index === focusedIndex;
              return (
                <div
                  key={virtualRow.key}
                  role="presentation"
                  className="absolute inset-x-0"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <ObjectsTreeRow
                    node={node}
                    depth={row.depth}
                    isExpanded={expanded}
                    isSelected={isSelected}
                    onToggle={onToggle}
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
      </ContextMenu.Trigger>

      <ObjectsContextMenu node={menuNode} onOpen={onOpen} />
    </ContextMenu.Root>
  );
}
