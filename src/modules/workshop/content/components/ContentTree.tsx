import type { KeyboardEvent, MouseEvent as ReactMouseEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useZoomedPx } from "@/hooks";
import type { LayerContent } from "@/lib/tauri";
import { isChord } from "@/modules/keys";

import {
  declarationsDocument,
  ignoreRulesDocument,
  previewDocument,
} from "../../documents/utils/contentDocument";
import { type NodeActivation, useBrowseTree, useReadOnlyTreeNav } from "../../hooks";
import { MODIGNORE_FILE_NAME } from "../../ignore-rules";
import { useProjectContext } from "../../projects/state/ProjectContext";
import { VirtualTree } from "../../shared/components/VirtualTree";
import { treeItemIndexOf } from "../../shared/utils/tree";
import {
  useCollapseLayerDirs,
  useCollapsedDirs,
  useOpenDocument,
  useOpenRowPreview,
  useRevealRequest,
  useToggleCollapsed,
} from "../../state";
import {
  allDirPaths,
  buildContentTree,
  buildDirFileCounts,
  type ContentTreeNode,
  type DirNode,
  type FileNode,
  flattenTree,
  type FlatTreeRow,
  nodeCovers,
  toggledDirTree,
} from "../utils/contentTree";
import { AssetDragGhost } from "./AssetDragGhost";
import { ContentTreeContextMenu } from "./ContentTreeContextMenu";
import { TreeRow } from "./ContentTreeRow";
import { DeleteContentPopover, type DeleteContentTarget } from "./DeleteContentPopover";

/** Fixed row height (px). Used by the virtualizer so we can precompute row
 * positions without per-row measurement. */
const ROW_HEIGHT = 24;

/* The `py-1` above the first row, which the pinned band reads the scroll past. */
const CONTENT_TOP = 4;

function rowKey(row: FlatTreeRow): string {
  return nodeKey(row.node);
}

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
  const collapseLayerDirs = useCollapseLayerDirs();
  const rows = useMemo(() => flattenTree(tree, collapsed), [tree, collapsed]);

  const toggleSubtree = useCallback(
    (dir: DirNode) => collapseLayerDirs(layerName, toggledDirTree(collapsed, dir)),
    [collapseLayerDirs, layerName, collapsed],
  );
  const collapseAll = useCallback(
    () => collapseLayerDirs(layerName, allDirPaths(tree)),
    [collapseLayerDirs, layerName, tree],
  );

  const documentFor = useCallback(
    (node: FileNode) => {
      /* A nested `.modignore` opens as rules rather than as bytes, which is the
         only way the tree reaches one. */
      if (node.name === MODIGNORE_FILE_NAME) {
        return ignoreRulesDocument(`content/${layerName}/${node.entry.relativePath}`);
      }
      if (node.entry.kind === "game_data") return declarationsDocument(layerName);

      return previewDocument({
        kind: "layer",
        project: projectPath,
        layer: layerName,
        path: node.entry.relativePath,
      });
    },
    [projectPath, layerName],
  );

  const previewRow = useOpenRowPreview();
  const openDocument = useOpenDocument();
  const previewFile = useCallback(
    (node: FileNode) => previewRow(documentFor(node)),
    [previewRow, documentFor],
  );
  const openFile = useCallback(
    (node: FileNode) => openDocument(documentFor(node)),
    [openDocument, documentFor],
  );

  const isOpenBranch = useCallback(
    (row: FlatTreeRow) => row.node.type === "dir" && !collapsed.has(row.node.path),
    [collapsed],
  );

  const zoomed = useZoomedPx();
  const rowHeight = zoomed(ROW_HEIGHT);

  const { scrollRef, virtualizer, items, totalSize, sticky } = useBrowseTree({
    rows,
    rowHeight,
    offsetTop: CONTENT_TOP,
    keyOf: rowKey,
    isOpenBranch,
  });

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

  const isExpanded = useCallback(
    (node: ContentTreeNode) => node.type === "dir" && !collapsed.has(node.path),
    [collapsed],
  );
  const toggleNode = useCallback(
    (node: ContentTreeNode) => {
      if (node.type === "dir") toggle(node.path);
    },
    [toggle],
  );
  const openNode = useCallback(
    (node: ContentTreeNode) => {
      if (node.type === "file") openFile(node);
    },
    [openFile],
  );

  /* The row's own key rather than the tree's, so no modifier a browser or the OS claims is in
     the way. The delete is confirmed either way. */
  const deleteKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>, node: ContentTreeNode) => {
      if (!isChord(event, "content.delete")) return false;

      event.preventDefault();
      requestDelete(node);
      return true;
    },
    [requestDelete],
  );

  const { focusedIndex, setFocusedIndex, handleKeyDown } = useReadOnlyTreeNav({
    rows,
    isExpanded,
    onToggle: toggleNode,
    onOpen: openNode,
    expandable: isDir,
    activation: activationOf,
    onKey: deleteKey,
    onCollapseAll: collapseAll,
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
    const index = treeItemIndexOf(event.target);
    setMenuNode(index === null ? null : (rows[index]?.node ?? null));
  }

  return (
    <>
      <AssetDragGhost />
      <VirtualTree
        data-ui="ContentTree"
        aria-label="Layer files"
        scrollRef={scrollRef}
        rows={rows}
        items={items}
        totalSize={totalSize}
        sticky={sticky}
        onKeyDown={handleKeyDown}
        onContextMenu={handleContextMenu}
        menu={
          <ContentTreeContextMenu
            node={menuNode}
            projectPath={projectPath}
            layerName={layerName}
            onOpen={openFile}
            onDelete={requestDelete}
          />
        }
        renderRow={(row, index, pinned) => {
          const isSelected = index === focusedIndex;
          const dirFileCount =
            row.node.type === "dir" ? (dirFileCounts.get(row.node.path) ?? 0) : 0;
          if (pinned) {
            return (
              <TreeRow
                layer={layerName}
                node={row.node}
                depth={row.depth}
                isExpanded
                isSelected={isSelected}
                dirFileCount={dirFileCount}
                onToggle={() => revealRow(index)}
                onSelect={setFocusedIndex}
                onOpen={openFile}
                height={rowHeight}
                rowIndex={index}
                tabIndex={-1}
              />
            );
          }

          return (
            <TreeRow
              layer={layerName}
              node={row.node}
              depth={row.depth}
              isExpanded={row.node.type === "dir" && !collapsed.has(row.node.path)}
              isSelected={isSelected}
              dirFileCount={dirFileCount}
              onToggle={toggle}
              onToggleSubtree={toggleSubtree}
              onSelect={setFocusedIndex}
              onOpen={openFile}
              onPreview={previewFile}
              height={rowHeight}
              rowIndex={index}
              tabIndex={isSelected ? 0 : -1}
            />
          );
        }}
      />

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

function isDir(node: ContentTreeNode): boolean {
  return node.type === "dir";
}

/** `Enter` opens a file, the way a double click does, and folds a directory. */
function activationOf(node: ContentTreeNode): NodeActivation {
  return node.type === "file" ? "open" : "toggle";
}
