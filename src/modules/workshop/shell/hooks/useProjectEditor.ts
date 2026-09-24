import { useCallback, useEffect, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import type { BinRow } from "@/lib/tauri";
import { type DropOutcome, type Edge, findLeaf, type LayoutNode, leaves } from "@/modules/editor";
import { usePreviewOnClick } from "@/stores/workshopLayout";

import type { SelectedModule } from "../../bin/documents/state/editorFile";
import {
  isShellPaneId,
  openShellPanes,
  type ShellKind,
  type ShellPaneId,
} from "../../bin/shell/utils/shellPanes";
import { type ContentDocument, documentLayerName } from "../../documents/utils/contentDocument";
import type { OpenIntent } from "../../palette/utils/types";
import { useProjectContext } from "../../projects/state/ProjectContext";
import {
  type CurveAimRequest,
  EMPTY_EDITOR,
  type HistoryEntry,
  type IgnoreLineRevealRequest,
  NO_COLLAPSED_DIRS,
  type RowRevealRequest,
  type RevealRequest,
  type StringKeyAimRequest,
  useWorkshopEditorStore,
} from "../state/workshopEditor";

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

/** One group's ephemeral tab, which draws in italic and that group's next open replaces. */
export function usePreviewDocumentId(leafId: string): string | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore(
    (s) => (s.byProject[projectPath] ?? EMPTY_EDITOR).previewIds[leafId] ?? null,
  );
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
 * What a single click on a row calls while the preview setting is on.
 * {@link useOpenDocumentTab} picks between this and a permanent open.
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
 * Opens a document the way the user asked a click to open one.
 *
 * The replaceable tab while the setting is on, and a tab of its own while it is
 * off. Either way a document that is already open activates where it sits
 * rather than opening twice.
 */
export function useOpenDocumentTab() {
  const previewOnClick = usePreviewOnClick();
  const openPreview = useOpenPreview();
  const openDocument = useOpenDocument();
  return useCallback(
    (document: ContentDocument) => {
      if (previewOnClick) openPreview(document);
      else openDocument(document);
    },
    [previewOnClick, openPreview, openDocument],
  );
}

/**
 * What a single click on a tree row opens: the replaceable tab, or nothing.
 *
 * A click that opens nothing is a click that selects the row alone, which is
 * what the setting off asks for. A double click opens through
 * {@link useOpenDocument} either way, which keeps whatever the click previewed.
 *
 * Per "How a file opens" in `docs/ux/PROJECT_EDITOR.md`.
 */
export function useOpenRowPreview() {
  const previewOnClick = usePreviewOnClick();
  const openPreview = useOpenPreview();
  return useCallback(
    (document: ContentDocument) => {
      if (previewOnClick) openPreview(document);
    },
    [previewOnClick, openPreview],
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

/** Close every document a layer owns, which is what a delete of that layer asks for. */
export function useCloseLayerDocuments() {
  const projectPath = useProjectPath();
  const closeLayerDocuments = useWorkshopEditorStore((s) => s.closeLayerDocuments);
  return useCallback(
    (layerName: string) => closeLayerDocuments(projectPath, layerName),
    [closeLayerDocuments, projectPath],
  );
}

/** Whether a reopen has anything to put back, which the key and the command read. */
export function useHasClosedDocuments(): boolean {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => s.closed.some((tab) => tab.project === projectPath));
}

/**
 * Puts the newest tab this project closed back, permanent and pinned as it was.
 *
 * What `Ctrl+Shift+T` and the palette's own row ask for. A press with nothing
 * closed does nothing.
 */
export function useReopenClosedDocument() {
  const projectPath = useProjectPath();
  return useCallback(() => {
    const store = useWorkshopEditorStore.getState();
    const document = store.reopenClosedDocument(projectPath);

    const layerName = documentLayerName(document);
    if (layerName) store.selectLayer(projectPath, layerName);
  }, [projectPath]);
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

/** The project's "Use game data declarations" choice, undefined where it made none. */
export function useUseDeclarationsChoice(projectPath: string | undefined): boolean | undefined {
  return useWorkshopEditorStore((s) =>
    projectPath === undefined ? undefined : s.byProject[projectPath]?.useDeclarations,
  );
}

export function useSetUseDeclarations() {
  const projectPath = useProjectPath();
  const setUseDeclarations = useWorkshopEditorStore((s) => s.setUseDeclarations);
  return useCallback(
    (on: boolean) => setUseDeclarations(projectPath, on),
    [setUseDeclarations, projectPath],
  );
}

/** The module a declared document's new keys join, null for the default placement. ADR-0048. */
export function useSelectedModule(): SelectedModule | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => (s.byProject[projectPath] ?? EMPTY_EDITOR).selectedModule);
}

export function useSelectModule() {
  const projectPath = useProjectPath();
  const selectModule = useWorkshopEditorStore((s) => s.selectModule);
  return useCallback(
    (selected: SelectedModule | null) => selectModule(projectPath, selected),
    [selectModule, projectPath],
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

/** Open every directory in `paths` that the user had shut, for a reveal. */
export function useOpenLayerDirs() {
  const projectPath = useProjectPath();
  const openDirs = useWorkshopEditorStore((s) => s.openDirs);
  return useCallback(
    (layerName: string, paths: readonly string[]) => openDirs(projectPath, layerName, paths),
    [openDirs, projectPath],
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
 * The pending row request aimed at `documentId`, or null.
 *
 * Null for a tab nobody addressed. A request meant for another tab re-renders no other
 * bin.
 */
export function useRowRevealRequest(documentId: string): RowRevealRequest | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const request = (s.byProject[projectPath] ?? EMPTY_EDITOR).revealRow;
    if (!request || request.documentId !== documentId) return null;
    return request;
  });
}

/** Drop the row request with `token`. The tab it addressed has answered it. */
export function useSettleRowReveal() {
  const projectPath = useProjectPath();
  const settle = useWorkshopEditorStore((s) => s.settleRowReveal);
  return useCallback((token: number) => settle(projectPath, token), [settle, projectPath]);
}

/** Ask the open tab `documentId` to expand down to the row `key` and scroll to it. */
export function useRevealRow() {
  const projectPath = useProjectPath();
  const revealRow = useWorkshopEditorStore((s) => s.revealRow);
  return useCallback(
    (documentId: string, key: string) => revealRow(projectPath, documentId, key),
    [revealRow, projectPath],
  );
}

/** The pending line request aimed at `documentId`, or null for a tab nobody aimed. */
export function useIgnoreLineRevealRequest(documentId: string): IgnoreLineRevealRequest | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const request = (s.byProject[projectPath] ?? EMPTY_EDITOR).revealIgnoreLine;
    if (!request || request.documentId !== documentId) return null;
    return request;
  });
}

/** Ask the open rules document `documentId` to sit on `line`. */
export function useRevealIgnoreLine() {
  const projectPath = useProjectPath();
  const revealIgnoreLine = useWorkshopEditorStore((s) => s.revealIgnoreLine);
  return useCallback(
    (documentId: string, line: number) => revealIgnoreLine(projectPath, documentId, line),
    [revealIgnoreLine, projectPath],
  );
}

/** Drop the line request with `token`. The document it addressed has answered it. */
export function useSettleIgnoreLineReveal() {
  const projectPath = useProjectPath();
  const settle = useWorkshopEditorStore((s) => s.settleIgnoreLineReveal);
  return useCallback((token: number) => settle(projectPath, token), [settle, projectPath]);
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

/** The pending key request aimed at `documentId`, or null for a document nobody aimed. */
export function useStringKeyAimRequest(documentId: string): StringKeyAimRequest | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => {
    const request = (s.byProject[projectPath] ?? EMPTY_EDITOR).aimStringKey;
    if (!request || request.documentId !== documentId) return null;
    return request;
  });
}

/** Drop the key request with `token`. The document it addressed has answered it. */
export function useSettleStringKeyAim() {
  const projectPath = useProjectPath();
  const settle = useWorkshopEditorStore((s) => s.settleStringKeyAim);
  return useCallback((token: number) => settle(projectPath, token), [settle, projectPath]);
}

/** Ask the strings document `documentId` to take up `key`, whose in-game text is `line`. */
export function useAimStringKey() {
  const projectPath = useProjectPath();
  const aimStringKey = useWorkshopEditorStore((s) => s.aimStringKey);
  return useCallback(
    (documentId: string, key: string, line: string) =>
      aimStringKey(projectPath, documentId, key, line),
    [aimStringKey, projectPath],
  );
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
