import { useVirtualizer } from "@tanstack/react-virtual";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContextMenu } from "@/components";
import { NO_OVERSCROLL, useZoomedPx } from "@/hooks";

import { useReadOnlyTreeNav, useStickyTreeRows } from "../../hooks";
import type { OpenIntent } from "../../palette/utils/types";
import { TreeStickyBand } from "../../shared/components/TreeStickyBand";
import type {
  ReferenceFileNode,
  ReferenceNode,
  ReferenceObjectNode,
  ReferenceRow,
} from "../utils/referenceTree";
import { flattenReferences } from "../utils/referenceTree";
import { ReferencesContextMenu } from "./ReferencesContextMenu";
import { ReferencesTreeRow } from "./ReferencesTreeRow";

/* The objects tree's fixed row height. Every read-only tree of the editor scans alike. */
const ROW_HEIGHT = 24;

/* The `py-1` above the first row, which the pinned band reads the scroll past. */
const CONTENT_TOP = 4;

interface ReferencesTreeProps {
  files: readonly ReferenceFileNode[];
  ariaLabel: string;
  isShut: (node: ReferenceFileNode) => boolean;
  onToggle: (node: ReferenceFileNode) => void;
  /** Collapse every file, for `Ctrl+Left`. */
  onCollapseAll?: () => void;
  /** A click on an object row, or its Open menu item. */
  onOpen: (node: ReferenceObjectNode, intent: OpenIntent) => void;
}

/**
 * A read-only virtualized tree over one query's answer: a file, then its objects.
 *
 * The objects browser's tree at two fixed levels, with the declaring file pinned above
 * the objects it holds.
 */
export function ReferencesTree({
  files,
  ariaLabel,
  isShut,
  onToggle,
  onCollapseAll,
  onOpen,
}: ReferencesTreeProps) {
  const rows = useMemo(() => flattenReferences(files, isShut), [files, isShut]);

  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomed = useZoomedPx();
  const rowHeight = zoomed(ROW_HEIGHT);

  const isOpenBranch = useCallback(
    (row: ReferenceRow) => row.node.type === "file" && !isShut(row.node),
    [isShut],
  );

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
    scrollPaddingStart: stickyHeight,
  });

  /* Sizes cached at the old zoom outlive a change to it: `estimateSize` is not one of
     the inputs the measurement memo watches. */
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoomed]);

  const { focusedIndex, setFocusedIndex, moveFocus, handleKeyDown } = useReadOnlyTreeNav({
    rows,
    isExpanded: (node: ReferenceNode) => node.type === "file" && !isShut(node),
    onToggle: (node: ReferenceNode) => {
      if (node.type === "file") onToggle(node);
    },
    onOpen: (node: ReferenceNode, intent) => {
      if (node.type === "object") onOpen(node, intent);
    },
    expandable: (node: ReferenceNode) => node.type === "file",
    activation: (node: ReferenceNode) => (node.type === "file" ? "toggle" : "open"),
    virtualizer,
    scrollElementRef: scrollRef,
    onCollapseAll,
  });

  /* One menu for the whole tree, pointed at the row the event came from. */
  const [menuNode, setMenuNode] = useState<ReferenceNode | null>(null);

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-treeitem-index]");
    const index = Number(row?.dataset.treeitemIndex);
    setMenuNode(Number.isInteger(index) ? (rows[index]?.node ?? null) : null);
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        data-ui="ReferencesTree"
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
                <ReferencesTreeRow
                  node={pin.row.node}
                  depth={pin.row.depth}
                  isExpanded
                  isSelected={pin.index === focusedIndex}
                  /* A pinned row answers a click by going to the row it stands for.
                     Shutting from up there would hide a group whose extent the user
                     cannot see. */
                  onToggle={() => moveFocus(pin.index)}
                  onSelect={setFocusedIndex}
                  onOpen={() => moveFocus(pin.index)}
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
              const isSelected = virtualRow.index === focusedIndex;
              return (
                <div
                  key={virtualRow.key}
                  role="presentation"
                  className="absolute inset-x-0"
                  style={{ transform: `translateY(${virtualRow.start}px)` }}
                >
                  <ReferencesTreeRow
                    node={node}
                    depth={row.depth}
                    isExpanded={node.type === "file" && !isShut(node)}
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

      <ReferencesContextMenu node={menuNode} onOpen={onOpen} />
    </ContextMenu.Root>
  );
}
