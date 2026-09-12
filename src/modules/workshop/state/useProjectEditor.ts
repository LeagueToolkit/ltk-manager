import { useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { BinRow } from "@/lib/tauri";
import { type DropOutcome, type Edge, findLeaf, type LayoutNode, leaves } from "@/modules/editor";
import { useTabOpenMode } from "@/stores/workshopLayout";

import { isShellPaneId, openShellPanes, type ShellKind, type ShellPaneId } from "../bin/shellPanes";
import { useProjectContext } from "../components/ProjectContext";
import { type ContentDocument, documentLayerName } from "../documents/contentDocument";
import type { OpenIntent } from "../palette/types";
import {
  type CurveAimRequest,
  EMPTY_EDITOR,
  type HistoryEntry,
  NO_COLLAPSED_DIRS,
  type ObjectRevealRequest,
  type RevealRequest,
  useWorkshopEditorStore,
} from "./workshopEditor";

/**
 * The editor state of the project the caller is mounted inside.
 *
 * Every hook here resolves its project from the surrounding `ProjectProvider`,
 * so a panel reads what it needs without being handed a path. Where a panel
 * hangs - either side panel, the document surface, a cell of a future grid -
 * then has no bearing on how it reaches state, which is what lets a panel move
 * without its call sites changing.
 */
function useProjectPath(): string {
  return useProjectContext().path;
}

export function useLayoutTree(): LayoutNode {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => (s.byProject[projectPath] ?? EMPTY_EDITOR).layout);
}

export function useActiveLeafId(): string {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => (s.byProject[projectPath] ?? EMPTY_EDITOR).activeLeafId);
}

/** One leaf's tabs resolved to documents, in strip order. */
export function useLeafTabs(leafId: string): readonly ContentDocument[] {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore(
    useShallow((s) => {
      const editor = s.byProject[projectPath] ?? EMPTY_EDITOR;
      const leaf = findLeaf(editor.layout, leafId);
      return (leaf?.tabs ?? []).flatMap((id) => {
        const document = editor.documents[id];
        return document ? [document] : [];
      });
    }),
  );
}

export function useLeafActiveId(leafId: string): string | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const editor = s.byProject[projectPath] ?? EMPTY_EDITOR;
    return findLeaf(editor.layout, leafId)?.activeTab ?? null;
  });
}

/** Every open document, in depth-first reading order across the leaves. */
export function useOpenDocuments(): readonly ContentDocument[] {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore(
    useShallow((s) => {
      const editor = s.byProject[projectPath] ?? EMPTY_EDITOR;
      return leaves(editor.layout)
        .flatMap((leaf) => leaf.tabs)
        .flatMap((id) => {
          const document = editor.documents[id];
          return document ? [document] : [];
        });
    }),
  );
}

/** The active tab of the focused leaf, which is what the sidebar highlights. */
export function useActiveDocumentId(): string | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const editor = s.byProject[projectPath] ?? EMPTY_EDITOR;
    return findLeaf(editor.layout, editor.activeLeafId)?.activeTab ?? null;
  });
}

/** The ephemeral tab, which draws in italic and the next open replaces. */
export function usePreviewDocumentId(): string | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => (s.byProject[projectPath] ?? EMPTY_EDITOR).previewId);
}

export function useDirtyDocumentIds(): ReadonlySet<string> {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => (s.byProject[projectPath] ?? EMPTY_EDITOR).dirty);
}

/** The documents a user pinned, which lead their strip. */
export function usePinnedDocumentIds(): readonly string[] {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => (s.byProject[projectPath] ?? EMPTY_EDITOR).pinned);
}

export function useSetDocumentPinned() {
  const projectPath = useProjectPath();
  const setDocumentPinned = useWorkshopEditorStore((s) => s.setDocumentPinned);
  return useCallback(
    (id: string, pinned: boolean) => setDocumentPinned(projectPath, id, pinned),
    [setDocumentPinned, projectPath],
  );
}

/**
 * The layer that every layer-scoped panel reads.
 *
 * Falls back to the first layer when the project has chosen none yet, and when
 * the chosen one is gone, which is what a delete of the selected layer leaves
 * behind.
 */
export function useSelectedLayerName(): string | null {
  const project = useProjectContext();
  const selected = useWorkshopEditorStore(
    (s) => (s.byProject[project.path] ?? EMPTY_EDITOR).selectedLayer,
  );

  const layers = project.layers;
  return useMemo(() => {
    if (selected && layers.some((layer) => layer.name === selected)) return selected;
    return layers[0]?.name ?? null;
  }, [layers, selected]);
}

export function useCollapsedDirs(layerName: string): ReadonlySet<string> {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore(
    (s) => (s.byProject[projectPath] ?? EMPTY_EDITOR).collapsed[layerName] ?? NO_COLLAPSED_DIRS,
  );
}

/**
 * The pending reveal for one layer's tree, or null when another layer was asked.
 *
 * Returning null for a tree nobody addressed also keeps it from re-rendering on
 * a request meant for its neighbour.
 */
export function useRevealRequest(layerName: string): RevealRequest | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const request = (s.byProject[projectPath] ?? EMPTY_EDITOR).reveal;
    if (!request || request.layerName !== layerName) return null;
    return request;
  });
}

/** Open the document another surface asked for, once the editor can hold it. */
export function useRequestedDocument(projectPath: string, ready: boolean) {
  useEffect(() => {
    if (!ready) return;

    const store = useWorkshopEditorStore.getState();
    const document = store.takePendingDocument(projectPath);
    if (document) store.openDocument(projectPath, document);
  }, [projectPath, ready]);
}

export function useOpenDocument() {
  const projectPath = useProjectPath();
  return useCallback(
    (document: ContentDocument) => {
      const store = useWorkshopEditorStore.getState();
      store.openDocument(projectPath, document);

      const layerName = documentLayerName(document);
      if (layerName) store.selectLayer(projectPath, layerName);
    },
    [projectPath],
  );
}

/**
 * Opens a document as the ephemeral tab, in place of whichever one holds that
 * role.
 *
 * What the `replace` tab mode calls. {@link useOpenDocumentTab} picks between
 * this and a permanent open, and is what a tree row actually wires up.
 */
export function useOpenPreview() {
  const projectPath = useProjectPath();
  return useCallback(
    (document: ContentDocument) => {
      const store = useWorkshopEditorStore.getState();
      store.openPreview(projectPath, document);

      const layerName = documentLayerName(document);
      if (layerName) store.selectLayer(projectPath, layerName);
    },
    [projectPath],
  );
}

/**
 * Opens a document the way the user asked tabs to open.
 *
 * What a tree row wires up. `append` gives the document its own tab and
 * `replace` reuses the ephemeral one, and either way a document that is
 * already open activates where it sits rather than opening twice.
 */
export function useOpenDocumentTab() {
  const mode = useTabOpenMode();
  const openPreview = useOpenPreview();
  const openDocument = useOpenDocument();
  return useCallback(
    (document: ContentDocument) => {
      if (mode === "replace") openPreview(document);
      else openDocument(document);
    },
    [mode, openPreview, openDocument],
  );
}

/**
 * Opens into a fresh group beside the focused one.
 *
 * What `Ctrl+Enter` on a palette row asks for, and what a future Open to the
 * Side wires up.
 */
export function useOpenDocumentBeside() {
  const projectPath = useProjectPath();
  const openDocumentBeside = useWorkshopEditorStore((s) => s.openDocumentBeside);
  return useCallback(
    (document: ContentDocument) => {
      openDocumentBeside(projectPath, document);

      const layerName = documentLayerName(document);
      if (layerName) useWorkshopEditorStore.getState().selectLayer(projectPath, layerName);
    },
    [openDocumentBeside, projectPath],
  );
}

/**
 * Opens a document the way an intent asks: the tab mode, beside the focused group,
 * or as a pinned tab.
 *
 * What `Enter` and its modifiers on a palette row ask for, and what a click and a
 * `Ctrl+click` on a row's action or a link chip ask for.
 */
export function useOpenDocumentAs() {
  const openTab = useOpenDocumentTab();
  const openDocument = useOpenDocument();
  const openBeside = useOpenDocumentBeside();
  return useCallback(
    (document: ContentDocument, intent: OpenIntent) => {
      if (intent === "beside") openBeside(document);
      else if (intent === "permanent") openDocument(document);
      else openTab(document);
    },
    [openBeside, openDocument, openTab],
  );
}

/** The intent a click carries: beside with `Ctrl` or `Cmd` held, the tab mode without. */
export function clickIntent(event: { ctrlKey: boolean; metaKey: boolean }): OpenIntent {
  return event.ctrlKey || event.metaKey ? "beside" : "default";
}

export function usePromoteDocument() {
  const projectPath = useProjectPath();
  const promoteDocument = useWorkshopEditorStore((s) => s.promoteDocument);
  return useCallback(
    (id: string) => promoteDocument(projectPath, id),
    [promoteDocument, projectPath],
  );
}

export function useActivateDocument() {
  const projectPath = useProjectPath();
  return useCallback(
    (leafId: string, id: string) => {
      const store = useWorkshopEditorStore.getState();
      store.activateDocument(projectPath, leafId, id);

      /* The panels follow the strip while the tree is still a document. Once it
         is a panel of its own, selection is the sidebar's alone and this goes. */
      const document = store.byProject[projectPath]?.documents[id] ?? null;
      const layerName = documentLayerName(document);
      if (layerName) store.selectLayer(projectPath, layerName);
    },
    [projectPath],
  );
}

export function useCloseDocument() {
  const projectPath = useProjectPath();
  const closeDocument = useWorkshopEditorStore((s) => s.closeDocument);
  return useCallback(
    (leafId: string, id: string) => closeDocument(projectPath, leafId, id),
    [closeDocument, projectPath],
  );
}

export function useReorderDocuments() {
  const projectPath = useProjectPath();
  const reorderDocuments = useWorkshopEditorStore((s) => s.reorderDocuments);
  return useCallback(
    (leafId: string, ids: readonly string[]) => reorderDocuments(projectPath, leafId, ids),
    [reorderDocuments, projectPath],
  );
}

export function useMoveDocument() {
  const projectPath = useProjectPath();
  const moveDocument = useWorkshopEditorStore((s) => s.moveDocument);
  return useCallback(
    (documentId: string, toLeafId: string, index?: number) =>
      moveDocument(projectPath, documentId, toLeafId, index),
    [moveDocument, projectPath],
  );
}

export function useSplitWithDocument() {
  const projectPath = useProjectPath();
  const splitWithDocument = useWorkshopEditorStore((s) => s.splitWithDocument);
  return useCallback(
    (documentId: string, targetLeafId: string, edge: Edge) =>
      splitWithDocument(projectPath, documentId, targetLeafId, edge),
    [splitWithDocument, projectPath],
  );
}

export function useFocusLeaf() {
  const projectPath = useProjectPath();
  return useCallback(
    (leafId: string) => {
      const store = useWorkshopEditorStore.getState();
      store.focusLeaf(projectPath, leafId);

      /* Focus follows the layer of whatever the leaf shows, the same way an
         activate does, so the side panels track the surface being worked in. */
      const editor = store.byProject[projectPath];
      const activeTab = editor ? findLeaf(editor.layout, leafId)?.activeTab : null;
      const document = activeTab ? (editor?.documents[activeTab] ?? null) : null;
      const layerName = documentLayerName(document);
      if (layerName) store.selectLayer(projectPath, layerName);
    },
    [projectPath],
  );
}

export function useSetSplitLayout() {
  const projectPath = useProjectPath();
  const setSplitLayout = useWorkshopEditorStore((s) => s.setSplitLayout);
  return useCallback(
    (splitId: string, layout: Record<string, number>) =>
      setSplitLayout(projectPath, splitId, layout),
    [setSplitLayout, projectPath],
  );
}

export function useResetLayout() {
  const projectPath = useProjectPath();
  const resetLayout = useWorkshopEditorStore((s) => s.resetLayout);
  return useCallback(() => resetLayout(projectPath), [resetLayout, projectPath]);
}

/** One group holds itself against an open that did not name it. */
export function useLeafLocked(leafId: string): boolean {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const editor = s.byProject[projectPath] ?? EMPTY_EDITOR;
    return findLeaf(editor.layout, leafId)?.locked === true;
  });
}

export function useSetLeafLocked() {
  const projectPath = useProjectPath();
  const setLeafLocked = useWorkshopEditorStore((s) => s.setLeafLocked);
  return useCallback(
    (leafId: string, locked: boolean) => setLeafLocked(projectPath, leafId, locked),
    [setLeafLocked, projectPath],
  );
}

/**
 * The panel filling the grid, or null while the tree draws whole.
 *
 * Null for a leaf the tree has lost, which is what a prune leaves behind.
 */
export function useMaximizedLeafId(): string | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const editor = s.byProject[projectPath] ?? EMPTY_EDITOR;
    if (editor.maximizedLeafId === null) return null;
    return findLeaf(editor.layout, editor.maximizedLeafId) ? editor.maximizedLeafId : null;
  });
}

/** Fill the grid with one panel, or give the tree back. */
export function useToggleMaximizedLeaf() {
  const projectPath = useProjectPath();
  const toggleMaximizedLeaf = useWorkshopEditorStore((s) => s.toggleMaximizedLeaf);
  return useCallback(
    (leafId: string) => toggleMaximizedLeaf(projectPath, leafId),
    [toggleMaximizedLeaf, projectPath],
  );
}

/** Give the tree back, which is what Esc asks for. */
export function useRestoreMaximizedLeaf() {
  const projectPath = useProjectPath();
  const restoreMaximizedLeaf = useWorkshopEditorStore((s) => s.restoreMaximizedLeaf);
  return useCallback(() => restoreMaximizedLeaf(projectPath), [restoreMaximizedLeaf, projectPath]);
}

export function useSetDocumentDirty() {
  const projectPath = useProjectPath();
  const setDocumentDirty = useWorkshopEditorStore((s) => s.setDocumentDirty);
  return useCallback(
    (id: string, dirty: boolean) => setDocumentDirty(projectPath, id, dirty),
    [setDocumentDirty, projectPath],
  );
}

export function useSelectLayer() {
  const projectPath = useProjectPath();
  const selectLayer = useWorkshopEditorStore((s) => s.selectLayer);
  return useCallback(
    (layerName: string) => selectLayer(projectPath, layerName),
    [selectLayer, projectPath],
  );
}

export function useToggleCollapsed(layerName: string) {
  const projectPath = useProjectPath();
  const toggleCollapsed = useWorkshopEditorStore((s) => s.toggleCollapsed);
  return useCallback(
    (path: string) => toggleCollapsed(projectPath, layerName, path),
    [toggleCollapsed, projectPath, layerName],
  );
}

export function useRevealInTree() {
  const projectPath = useProjectPath();
  const reveal = useWorkshopEditorStore((s) => s.reveal);
  return useCallback(
    (layerName: string, path: string) => reveal(projectPath, layerName, path),
    [reveal, projectPath],
  );
}

/**
 * The pending object request aimed at `documentId`, or null.
 *
 * Null for a bin nobody addressed. A request meant for another tab re-renders no other
 * bin.
 */
export function useObjectRevealRequest(documentId: string): ObjectRevealRequest | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const request = (s.byProject[projectPath] ?? EMPTY_EDITOR).revealObject;
    if (!request || request.documentId !== documentId) return null;
    return request;
  });
}

/** Drop the object request with `token`. The bin it addressed has answered it. */
export function useSettleObjectReveal() {
  const projectPath = useProjectPath();
  const settle = useWorkshopEditorStore((s) => s.settleObjectReveal);
  return useCallback((token: number) => settle(projectPath, token), [settle, projectPath]);
}

/** Ask the open bin `documentId` to expand `objectHash` and scroll to it. */
export function useRevealObject() {
  const projectPath = useProjectPath();
  const revealObject = useWorkshopEditorStore((s) => s.revealObject);
  return useCallback(
    (documentId: string, objectHash: string) => revealObject(projectPath, documentId, objectHash),
    [revealObject, projectPath],
  );
}

/** The pending curve request aimed at `documentId`, or null for a tab nobody aimed. */
export function useCurveAimRequest(documentId: string): CurveAimRequest | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const request = (s.byProject[projectPath] ?? EMPTY_EDITOR).aimCurve;
    if (!request || request.documentId !== documentId) return null;
    return request;
  });
}

/** Drop the curve request with `token`. The tab it addressed has answered it. */
export function useSettleCurveAim() {
  const projectPath = useProjectPath();
  const settle = useWorkshopEditorStore((s) => s.settleCurveAim);
  return useCallback((token: number) => settle(projectPath, token), [settle, projectPath]);
}

/** Ask the object tab `documentId` to open its dock on `row`, captioned `chain`. */
export function useAimCurve() {
  const projectPath = useProjectPath();
  const aimCurve = useWorkshopEditorStore((s) => s.aimCurve);
  return useCallback(
    (documentId: string, row: BinRow, chain: string) =>
      aimCurve(projectPath, documentId, row, chain),
    [aimCurve, projectPath],
  );
}

/**
 * Visited document ids, nearest first, each one once.
 *
 * Where the user stands leads, then where they came from, then where a forward
 * arrow would take them. This is both the order an empty palette lists its
 * documents in and the depth its history bonus decays over.
 */
export function useRecentDocumentIds(): readonly string[] {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore(
    useShallow((s) => {
      const seen = new Set<string>();

      /* One project's stops out of a stack that spans the shell, or another
         project's document ids would rank this project's rows. */
      const take = (entry: HistoryEntry | undefined) => {
        if (entry?.kind === "document" && entry.project === projectPath) seen.add(entry.documentId);
      };

      for (let at = s.historyIndex; at >= 0; at -= 1) take(s.history[at]);
      for (let at = s.historyIndex + 1; at < s.history.length; at += 1) take(s.history[at]);
      return [...seen];
    }),
  );
}

/** Moves this project's editor to the path a rename gave it. */
export function useMoveProjectDocuments() {
  const projectPath = useProjectPath();
  const moveProject = useWorkshopEditorStore((s) => s.moveProject);
  return useCallback(
    (toPath: string) => moveProject(projectPath, toPath),
    [moveProject, projectPath],
  );
}

/** The split tree of one shell's panes, which every object tab of that kind draws in. */
export function useShellLayout(kind: ShellKind): LayoutNode {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore(
    (s) => (s.byProject[projectPath] ?? EMPTY_EDITOR).shells[kind].layout,
  );
}

/** Which panes one pane leaf holds, in strip order. */
export function useShellPanes(kind: ShellKind, leafId: string): readonly ShellPaneId[] {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore(
    useShallow((s) => {
      const editor = s.byProject[projectPath] ?? EMPTY_EDITOR;
      return (findLeaf(editor.shells[kind].layout, leafId)?.tabs ?? []).filter(isShellPaneId);
    }),
  );
}

export function useShellActivePane(kind: ShellKind, leafId: string): ShellPaneId | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const editor = s.byProject[projectPath] ?? EMPTY_EDITOR;
    const active = findLeaf(editor.shells[kind].layout, leafId)?.activeTab;
    return isShellPaneId(active) ? active : null;
  });
}

/** Every pane the tree holds, which is what the Panes menu ticks. */
export function useOpenShellPanes(kind: ShellKind): ReadonlySet<ShellPaneId> {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore(
    useShallow((s) =>
      openShellPanes((s.byProject[projectPath] ?? EMPTY_EDITOR).shells[kind].layout),
    ),
  );
}

export function useActivateShellPane(kind: ShellKind) {
  const projectPath = useProjectPath();
  const activateShellPane = useWorkshopEditorStore((s) => s.activateShellPane);
  return useCallback(
    (leafId: string, paneId: ShellPaneId) => activateShellPane(projectPath, kind, leafId, paneId),
    [activateShellPane, projectPath, kind],
  );
}

export function useCloseShellPane(kind: ShellKind) {
  const projectPath = useProjectPath();
  const closeShellPane = useWorkshopEditorStore((s) => s.closeShellPane);
  return useCallback(
    (leafId: string, paneId: ShellPaneId) => closeShellPane(projectPath, kind, leafId, paneId),
    [closeShellPane, projectPath, kind],
  );
}

export function useOpenShellPane(kind: ShellKind) {
  const projectPath = useProjectPath();
  const openShellPane = useWorkshopEditorStore((s) => s.openShellPane);
  return useCallback(
    (paneId: ShellPaneId) => openShellPane(projectPath, kind, paneId),
    [openShellPane, projectPath, kind],
  );
}

export function useApplyShellDrop(kind: ShellKind) {
  const projectPath = useProjectPath();
  const applyShellDrop = useWorkshopEditorStore((s) => s.applyShellDrop);
  return useCallback(
    (outcome: DropOutcome) => applyShellDrop(projectPath, kind, outcome),
    [applyShellDrop, projectPath, kind],
  );
}

export function useSetShellSplitLayout(kind: ShellKind) {
  const projectPath = useProjectPath();
  const setShellSplitLayout = useWorkshopEditorStore((s) => s.setShellSplitLayout);
  return useCallback(
    (splitId: string, layout: Record<string, number>) =>
      setShellSplitLayout(projectPath, kind, splitId, layout),
    [setShellSplitLayout, projectPath, kind],
  );
}

export function useResetShellLayout(kind: ShellKind) {
  const projectPath = useProjectPath();
  const resetShellLayout = useWorkshopEditorStore((s) => s.resetShellLayout);
  return useCallback(
    () => resetShellLayout(projectPath, kind),
    [resetShellLayout, projectPath, kind],
  );
}

/**
 * The pane filling one shell, or null while its tree draws whole.
 *
 * Null for a leaf the tree has lost, which is what a prune leaves behind.
 */
export function useShellMaximizedLeaf(kind: ShellKind): string | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const editor = s.byProject[projectPath] ?? EMPTY_EDITOR;
    const leafId = editor.maximizedShellLeaf[kind];
    if (leafId === undefined) return null;
    return findLeaf(editor.shells[kind].layout, leafId) ? leafId : null;
  });
}

/** Fill one shell with one pane, or give its panes back. */
export function useToggleMaximizedShellLeaf(kind: ShellKind) {
  const projectPath = useProjectPath();
  const toggleMaximizedShellLeaf = useWorkshopEditorStore((s) => s.toggleMaximizedShellLeaf);
  return useCallback(
    (leafId: string) => toggleMaximizedShellLeaf(projectPath, kind, leafId),
    [toggleMaximizedShellLeaf, projectPath, kind],
  );
}

/** Give one shell's panes back, which is what Esc asks for. */
export function useRestoreMaximizedShellLeaf(kind: ShellKind) {
  const projectPath = useProjectPath();
  const restoreMaximizedShellLeaf = useWorkshopEditorStore((s) => s.restoreMaximizedShellLeaf);
  return useCallback(
    () => restoreMaximizedShellLeaf(projectPath, kind),
    [restoreMaximizedShellLeaf, projectPath, kind],
  );
}
