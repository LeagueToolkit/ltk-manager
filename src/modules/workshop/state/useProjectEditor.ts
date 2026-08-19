import { useCallback } from "react";

import {
  EMPTY_EDITOR,
  NO_COLLAPSED_DIRS,
  type RevealRequest,
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

export function useOpenDocuments(): readonly ContentDocument[] {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => (s.byProject[projectPath] ?? EMPTY_EDITOR).open);
}

export function useActiveDocumentId(): string | null {
  const projectPath = useProjectPath();
  return useWorkshopEditorStore((s) => (s.byProject[projectPath] ?? EMPTY_EDITOR).activeId);
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

  if (selected && project.layers.some((layer) => layer.name === selected)) return selected;
  return project.layers[0]?.name ?? null;
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

export function useActivateDocument() {
  const projectPath = useProjectPath();
  return useCallback(
    (id: string) => {
      const store = useWorkshopEditorStore.getState();
      store.activateDocument(projectPath, id);

      /* The panels follow the strip while the tree is still a document. Once it
         is a panel of its own, selection is the sidebar's alone and this goes. */
      const document = store.byProject[projectPath]?.open.find((candidate) => candidate.id === id);
      const layerName = document ? documentLayerName(document) : null;
      if (layerName) store.selectLayer(projectPath, layerName);
    },
    [projectPath],
  );
}

export function useCloseDocument() {
  const projectPath = useProjectPath();
  const closeDocument = useWorkshopEditorStore((s) => s.closeDocument);
  return useCallback((id: string) => closeDocument(projectPath, id), [closeDocument, projectPath]);
}

export function useReorderDocuments() {
  const projectPath = useProjectPath();
  const reorderDocuments = useWorkshopEditorStore((s) => s.reorderDocuments);
  return useCallback(
    (ids: readonly string[]) => reorderDocuments(projectPath, ids),
    [reorderDocuments, projectPath],
  );
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
