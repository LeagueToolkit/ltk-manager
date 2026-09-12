import { useVirtualizer } from "@tanstack/react-virtual";
import type { MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ContextMenu } from "@/components";
import { useZoomedPx } from "@/hooks";
import { NO_OVERSCROLL } from "@/hooks/useOverscrollSpring";
import type { LayerContent } from "@/lib/tauri";

import { ignoreRulesDocument, previewDocument } from "../documents/contentDocument";
import { useContentTreeNav, useStickyTreeRows } from "../hooks";
import { MODIGNORE_FILE_NAME } from "../ignore-rules";
import {
  useCollapsedDirs,
  useOpenDocumentTab,
  useRevealRequest,
  useToggleCollapsed,
} from "../state";
import {
  buildContentTree,
  buildDirFileCounts,
  type ContentTreeNode,
  type FileNode,
  flattenTree,
  type FlatTreeRow,
  nodeCovers,
} from "../utils/contentTree";
import { ContentTreeContextMenu } from "./ContentTreeContextMenu";
import { TreeRow } from "./ContentTreeRow";
import { DeleteContentPopover, type DeleteContentTarget } from "./DeleteContentPopover";
import { useProjectContext } from "./ProjectContext";
import { TreeStickyBand } from "./TreeStickyBand";

/** Fixed row height (px). Used by the virtualizer so we can precompute row
 * positions without per-row measurement. */
const ROW_HEIGHT = 24;

/* The `py-1` above the first row, which the pinned band reads the scroll past. */
const CONTENT_TOP = 4;

interface ContentTreeProps {
  layer: LayerContent;
}

export function ContentTree({ layer }: ContentTreeProps) {
  const layerName = layer.name;
  const project = useProjectContext();
  const projectPath = project.path;
  const tree = useMemo(
    () => buildContentTree(layer.entries, layer.ignoredDirectories),
    [layer.entries, layer.ignoredDirectories],
  );
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

  const openTab = useOpenDocumentTab();
  const openFile = useCallback(
    (node: FileNode) => {
      /* A nested `.modignore` opens as rules rather than as bytes, which is the
         only way the tree reaches one. */
      if (node.name === MODIGNORE_FILE_NAME) {
        openTab(ignoreRulesDocument(`content/${layerName}/${node.entry.relativePath}`));
        return;
      }

      openTab(
        previewDocument({
          kind: "layer",
          project: projectPath,
          layer: layerName,
          path: node.entry.relativePath,
        }),
      );
    },
    [openTab, projectPath, layerName],
  );

  const scrollRef = useRef<HTMLDivElement>(null);

  const isOpenBranch = useCallback(
    (row: FlatTreeRow) => row.node.type === "dir" && !collapsed.has(row.node.path),
    [collapsed],
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
    getItemKey: (index) => nodeKey(rows[index]!.node),
    /* Everything the tree scrolls to itself clears the pinned band rather than
       landing under it. */
    scrollPaddingStart: stickyHeight,
  });

  /* Sizes cached at the old zoom outlive a change to it: `estimateSize` is not
     one of the inputs the measurement memo watches. */
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoomed]);

  /* The tree owns the confirmation rather than the menu, so the keyboard route
     and the menu item reach the same one. The node rather than what the
     confirmation shows, because the row it points at is found through it too. */
  const [pendingNode, setPendingNode] = useState<ContentTreeNode | null>(null);
  const requestDelete = useCallback((node: ContentTreeNode) => setPendingNode(node), []);
  const pendingDelete = useMemo(
    () => (pendingNode ? deleteTarget(pendingNode, dirFileCounts) : null),
    [pendingNode, dirFileCounts],
  );

  /* Found again on every reposition rather than held: the virtualizer owns
     these elements, and a pinned row has a second copy of the one being
     deleted. The pinned copy comes first in the document, which is right - it
     is what is on screen once the real row has slid up behind the band. */
  const anchorRow = useCallback(() => {
    if (!pendingNode) return null;
    const key = nodeKey(pendingNode);
    const index = rows.findIndex((row) => nodeKey(row.node) === key);
    if (index < 0) return null;
    return (
      scrollRef.current?.querySelector<HTMLElement>(`[data-treeitem-index="${index}"]`) ?? null
    );
  }, [pendingNode, rows]);

  /* The popover has no trigger to hand focus back to, and the row it opened
     from may be the one just deleted. Base UI restores what it can, so this is
     only the rescue: without it a Del leaves the keyboard on nothing. */
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (pendingNode) {
      wasConfirming.current = true;
      return;
    }
    if (!wasConfirming.current) return;
    wasConfirming.current = false;
    if (scrollRef.current?.contains(document.activeElement)) return;
    scrollRef.current?.focus();
  }, [pendingNode]);

  const { focusedIndex, setFocusedIndex, handleKeyDown } = useContentTreeNav({
    rows,
    collapsed,
    onToggle: toggle,
    onOpen: openFile,
    onDelete: requestDelete,
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

  /* A pinned row answers a click by going to the row it stands for. Collapsing
     from up there would shut a directory the user cannot see the extent of. */
  const revealRow = useCallback(
    (index: number) => {
      setFocusedIndex(index);
      virtualizer.scrollToIndex(index, { align: "start" });
    },
    [setFocusedIndex, virtualizer],
  );

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
    <>
      <ContextMenu.Root>
        <ContextMenu.Trigger
          data-ui="ContentTree"
          ref={scrollRef}
          className="flex-1 overflow-auto font-mono text-xs outline-none scrollbar-md scrollbar-track"
          role="tree"
          aria-label="Layer files"
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
                  key={nodeKey(pin.row.node)}
                  role="presentation"
                  className="absolute inset-x-0 bg-surface-950"
                  /* Outermost on top, so the innermost row slides away behind it. */
                  style={{ top: `${pin.top}px`, zIndex: sticky.length - slot }}
                >
                  <TreeRow
                    node={pin.row.node}
                    depth={pin.row.depth}
                    isExpanded
                    isSelected={pin.index === focusedIndex}
                    dirFileCount={
                      pin.row.node.type === "dir" ? (dirFileCounts.get(pin.row.node.path) ?? 0) : 0
                    }
                    onToggle={() => revealRow(pin.index)}
                    onSelect={setFocusedIndex}
                    onOpen={openFile}
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
                      onOpen={openFile}
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

        <ContentTreeContextMenu
          node={menuNode}
          projectPath={projectPath}
          layerName={layerName}
          onOpen={openFile}
          onDelete={requestDelete}
        />
      </ContextMenu.Root>

      <DeleteContentPopover
        target={pendingDelete}
        anchor={anchorRow}
        projectPath={projectPath}
        layerName={layerName}
        onClose={() => setPendingNode(null)}
      />
    </>
  );
}

/** The row, as the little a confirmation needs to know about it. */
function deleteTarget(node: ContentTreeNode, counts: Map<string, number>): DeleteContentTarget {
  if (node.type === "file") {
    return { relativePath: node.entry.relativePath, name: node.name, isDir: false, fileCount: 0 };
  }
  /* A folded row's path is the deepest directory of its run, and the delete
     prunes what it empties, so the whole run goes - which is what the row's
     own joined name says it is. */
  return {
    relativePath: node.path,
    name: node.name,
    isDir: true,
    fileCount: counts.get(node.path) ?? 0,
  };
}

function nodeKey(node: ContentTreeNode): string {
  return node.type === "dir" ? `d:${node.path}` : `f:${node.entry.relativePath}`;
}
