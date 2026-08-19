import { useVirtualizer } from "@tanstack/react-virtual";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ContextMenu } from "@/components";
import { NO_OVERSCROLL } from "@/hooks/useOverscrollSpring";
import type { ContentEntry } from "@/lib/tauri";

import { useContentTreeNav } from "../hooks";
import { useCollapsedDirs, useRevealRequest, useToggleCollapsed } from "../state";
import {
  buildContentTree,
  buildDirFileCounts,
  type ContentTreeNode,
  flattenTree,
  nodeCovers,
} from "../utils/contentTree";
import { ContentTreeContextMenu } from "./ContentTreeContextMenu";
import { TreeRow } from "./ContentTreeRow";
import { useProjectContext } from "./ProjectContext";

/** Fixed row height (px). Used by the virtualizer so we can precompute row
 * positions without per-row measurement. */
const ROW_HEIGHT = 24;

interface ContentTreeProps {
  entries: readonly ContentEntry[];
  layerName: string;
}

export function ContentTree({ entries, layerName }: ContentTreeProps) {
  const projectPath = useProjectContext().path;
  const tree = useMemo(() => buildContentTree(entries), [entries]);
  const dirFileCounts = useMemo(() => buildDirFileCounts(tree), [tree]);
  /* What the user shut, not what is open. A rescan that adds a directory finds
     it absent here and renders it expanded, which is the default the tree
     claims. Seeding an open-set from the first tree instead left every later
     arrival collapsed.

     The store holds it rather than this component, so the shape of the tree
     outlives a trip to another layer and the panel move ahead of it. */
  const collapsed = useCollapsedDirs(layerName);
  const toggle = useToggleCollapsed(layerName);
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
    getItemKey: (index) => nodeKey(rows[index]!.node),
  });

  const { focusedIndex, setFocusedIndex, handleKeyDown } = useContentTreeNav({
    rows,
    collapsed,
    onToggle: toggle,
    virtualizer,
    scrollElementRef: scrollRef,
  });

  /* Null unless the request names this project and this layer, so the trees of
     the other open layers stay where the user left them. */
  const revealRequest = useRevealRequest(layerName);
  const revealedToken = useRef<number | null>(null);

  // Token rather than path, so the WAD list can ask for the same entry twice.
  useEffect(() => {
    if (revealRequest === null) return;
    if (revealRequest.token === revealedToken.current) return;
    revealedToken.current = revealRequest.token;

    const index = rows.findIndex((row) => nodeCovers(row.node, revealRequest.path));
    if (index < 0) return;

    setFocusedIndex(index);
    virtualizer.scrollToIndex(index, { align: "start" });
  }, [revealRequest, rows, setFocusedIndex, virtualizer]);

  /* One menu for the whole tree, pointed at the row the event came from. The
     virtualizer keeps dozens of rows mounted, and a menu on each of them is
     rebuilt every time the window slides. */
  const [menuNode, setMenuNode] = useState<ContentTreeNode | null>(null);

  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const row = (event.target as HTMLElement).closest<HTMLElement>("[data-treeitem-index]");
    const index = Number(row?.dataset.treeitemIndex);
    setMenuNode(Number.isInteger(index) ? (rows[index]?.node ?? null) : null);
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        data-ui="ContentTree"
        ref={scrollRef}
        className="flex-1 overflow-auto py-1 font-mono text-xs outline-none"
        role="tree"
        aria-label="Layer files"
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
            const isSelected = virtualRow.index === focusedIndex;
            return (
              <div
                key={virtualRow.key}
                role="presentation"
                className="absolute inset-x-0"
                style={{ transform: `translateY(${virtualRow.start}px)` }}
              >
                <TreeRow
                  node={row.node}
                  depth={row.depth}
                  isExpanded={row.node.type === "dir" && !collapsed.has(row.node.path)}
                  isSelected={isSelected}
                  dirFileCount={
                    row.node.type === "dir" ? (dirFileCounts.get(row.node.path) ?? 0) : 0
                  }
                  onToggle={toggle}
                  onSelect={setFocusedIndex}
                  height={ROW_HEIGHT}
                  rowIndex={virtualRow.index}
                  tabIndex={isSelected ? 0 : -1}
                />
              </div>
            );
          })}
        </div>
      </ContextMenu.Trigger>

      <ContentTreeContextMenu node={menuNode} projectPath={projectPath} layerName={layerName} />
    </ContextMenu.Root>
  );
}

function nodeKey(node: ContentTreeNode): string {
  return node.type === "dir" ? `d:${node.path}` : `f:${node.entry.relativePath}`;
}
