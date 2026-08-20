import { useCallback, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";

import { type Edge, findLeaf, type LayoutNode, leaves } from "@/modules/editor";
import {
  EMPTY_EDITOR,
  NO_COLLAPSED_DIRS,
  type RevealRequest,
  useTabOpenMode,
  useWorkshopEditorStore,
} from "@/stores";

import { useProjectContext } from "../components/ProjectContext";
import { type ContentDocument, documentLayerName } from "../documents";

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

/** Moves this project's editor to the path a rename gave it. */
export function useMoveProjectDocuments() {
  const projectPath = useProjectPath();
  const moveProject = useWorkshopEditorStore((s) => s.moveProject);
  return useCallback(
    (toPath: string) => moveProject(projectPath, toPath),
    [moveProject, projectPath],
  );
}
