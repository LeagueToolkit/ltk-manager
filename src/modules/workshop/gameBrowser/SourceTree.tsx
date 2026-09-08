import { useVirtualizer } from "@tanstack/react-virtual";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContextMenu } from "@/components";
import { useZoomedPx } from "@/hooks";
import { NO_OVERSCROLL } from "@/hooks/useOverscrollSpring";

import { TreeStickyBand } from "../components/TreeStickyBand";
import { useStickyTreeRows } from "../hooks";
import { keepScrollTop, keptScrollTop } from "../state";
import { type DirTargets, filesUnder, fileTarget } from "./extractTargets";
import {
  flattenSourceTree,
  type SourceDirNode,
  type SourceFileNode,
  type SourceRow,
  type SourceTreeNode,
} from "./sourceIndex";
import { SourceTreeContextMenu } from "./SourceTreeContextMenu";
import { SourceTreeRow } from "./SourceTreeRow";
import { type ExtractHow, useExtractActions } from "./useExtractActions";
import { useSourceTreeNav } from "./useSourceTreeNav";

/* The layer file tree's fixed row height, so the two trees scan alike. */
const ROW_HEIGHT = 24;

/* The `py-1` above the first row, which the pinned band reads the scroll past. */
const CONTENT_TOP = 4;

interface SourceTreeProps {
  nodes: readonly SourceTreeNode[];
  ariaLabel: string;
  isExpanded: (node: SourceDirNode) => boolean;
  onToggle: (node: SourceDirNode) => void;
  /** A double click on a file row, or its Open menu item. */
  onOpen?: (node: SourceFileNode) => void;
  /** Names this tree's scroll to the browser store. Absent starts at the top. */
  scrollKey?: string;
  /**
   * How a directory row of this tree becomes targets.
   *
   * The default walks the row's own children, which is right for a tree that
   * holds all of them. The whole-game tree reads a directory when it is first
   * opened, so it passes [`indexDir`](./extractTargets) instead.
   */
  dirTargets?: DirTargets;
}

/** A read-only virtualized tree over source nodes, from any source index. */
export function SourceTree({
  nodes,
  ariaLabel,
  isExpanded,
  onToggle,
  onOpen,
  scrollKey,
  dirTargets = filesUnder,
}: SourceTreeProps) {
  const rows = useMemo(() => flattenSourceTree(nodes, isExpanded), [nodes, isExpanded]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [initialOffset] = useState(() => (scrollKey ? keptScrollTop(scrollKey) : 0));

  /* The live element rather than one captured at mount, because where it ended
     up is the whole point of reading it here. */
  useEffect(() => {
    if (!scrollKey) return;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    return () => keepScrollTop(scrollKey, scrollRef.current?.scrollTop ?? 0);
  }, [scrollKey]);

  const isOpenBranch = useCallback(
    (row: SourceRow) => row.node.type === "dir" && isExpanded(row.node),
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
    /* Everything the tree scrolls to itself clears the pinned band rather than
       landing under it. */
    scrollPaddingStart: stickyHeight,
  });

  /* Sizes cached at the old zoom outlive a change to it: `estimateSize` is not
     one of the inputs the measurement memo watches. */
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoomed]);

  /* Every tree of the browser offers the same ways out, so the routes are read
     here rather than handed down by the three documents that mount one. */
  const { run } = useExtractActions();

  const runNode = useCallback(
    (node: SourceTreeNode, how: ExtractHow) => {
      if (node.type === "file") run(how, [fileTarget(node)], node.name);
      if (node.type === "dir") run(how, dirTargets(node), node.name);
    },
    [run, dirTargets],
  );

  const { focusedIndex, setFocusedIndex, handleKeyDown } = useSourceTreeNav({
    rows,
    isExpanded,
    onToggle,
    onOpen,
    onRun: runNode,
    virtualizer,
    scrollElementRef: scrollRef,
  });

  /* A pinned row answers a click by going to the row it stands for. Collapsing
     from up there would shut a directory the user cannot see the extent of. */
  const revealRow = useCallback(
    (index: number) => {
      setFocusedIndex(index);
      virtualizer.scrollToIndex(index, { align: "start" });
    },
    [setFocusedIndex, virtualizer],
  );

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
        className="flex-1 overflow-auto font-mono text-xs outline-none scrollbar-md scrollbar-track"
        role="tree"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        {...NO_OVERSCROLL}
      >
        {/* The padding rides inside the scrollport rather than on it: a sticky
            box is confined to its containing block, so the scroll container's
            own padding would hold the band that far below the top edge and let
            rows scroll through the gap above it. */}
        <div className="py-1">
          <TreeStickyBand height={stickyHeight}>
            {sticky.map((pin, slot) => (
              <div
                key={pin.row.node.id}
                role="presentation"
                className="absolute inset-x-0 bg-surface-950"
                /* Outermost on top, so the innermost row slides away behind it. */
                style={{ top: `${pin.top}px`, zIndex: sticky.length - slot }}
              >
                <SourceTreeRow
                  node={pin.row.node}
                  depth={pin.row.depth}
                  isExpanded
                  isSelected={pin.index === focusedIndex}
                  onToggle={() => revealRow(pin.index)}
                  onSelect={setFocusedIndex}
                  onOpen={onOpen}
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

      <SourceTreeContextMenu node={menuNode} onOpen={onOpen} onRun={runNode} />
    </ContextMenu.Root>
  );
}
