import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { ContentDocument } from "@/modules/workshop";

/** An outline's request that one layer's file tree scroll to an entry. */
export interface RevealRequest {
  readonly layerName: string;
  /** Path relative to the layer root, spelled as a content entry spells it. */
  readonly path: string;
  /** Bumped per request, so asking twice for the same entry still scrolls. */
  readonly token: number;
}

/**
 * Everything the editor holds for one project.
 *
 * `open`, `activeId` and `selectedLayer` persist. The rest is rebuilt each run:
 * a dirty flag belongs to an editor that is currently mounted, and neither the
 * shut directories nor a pending scroll are worth carrying across a restart.
 */
export interface ProjectEditor {
  /** The tab strip, in the order it displays. */
  open: ContentDocument[];
  activeId: string | null;
  /**
   * The layer every layer-scoped panel reads.
   *
   * Held rather than derived from the active tab, so a panel that is not a
   * document - the file tree, the WAD list - still has a layer to read once the
   * strip is empty or the active tab belongs to no layer.
   */
  selectedLayer: string | null;
  /** Ids with unsaved edits. Editors report their own. */
  dirty: ReadonlySet<string>;
  /** Directories the user shut, per layer name. Anything absent is open. */
  collapsed: Record<string, ReadonlySet<string>>;
  /** The pending scroll request, which at most one layer's tree answers. */
  reveal: RevealRequest | null;
}

interface WorkshopEditorStore {
  /** Editor state per project path, so switching projects keeps every set. */
  byProject: Record<string, ProjectEditor>;
  openDocument: (projectPath: string, document: ContentDocument) => void;
  activateDocument: (projectPath: string, id: string) => void;
  closeDocument: (projectPath: string, id: string) => void;
  /** Rewrites the strip's order from a full list of its ids. */
  reorderDocuments: (projectPath: string, ids: readonly string[]) => void;
  setDocumentDirty: (projectPath: string, id: string, dirty: boolean) => void;
  selectLayer: (projectPath: string, layerName: string) => void;
  toggleCollapsed: (projectPath: string, layerName: string, path: string) => void;
  reveal: (projectPath: string, layerName: string, path: string) => void;
  /** Follows a project whose path changed, so a rename keeps its editor. */
  moveProject: (fromPath: string, toPath: string) => void;
  /** Drops a deleted project, which would otherwise sit in storage forever. */
  forgetProject: (projectPath: string) => void;
}

export const EMPTY_EDITOR: ProjectEditor = {
  open: [],
  activeId: null,
  selectedLayer: null,
  dirty: new Set(),
  collapsed: {},
  reveal: null,
};

/** The collapsed-set of a layer nobody has shut a directory in. */
export const NO_COLLAPSED_DIRS: ReadonlySet<string> = new Set();

/* Closing the active tab hands focus to its right-hand neighbour, falling back
   to the left one at the end of the strip. */
function neighbourOf(open: readonly ContentDocument[], index: number): string | null {
  const next = open[index + 1] ?? open[index - 1];
  return next?.id ?? null;
}

/**
 * Apply a change to one project's editor, or report that nothing moved.
 *
 * Returning `null` lets the caller hand `set` the state object it was given.
 * Zustand compares by identity, so that is what makes an unchanged action skip
 * every subscriber rather than waking them with an equal value.
 */
function updateProject(
  state: WorkshopEditorStore,
  projectPath: string,
  change: (editor: ProjectEditor) => ProjectEditor | null,
): Pick<WorkshopEditorStore, "byProject"> | null {
  const current = state.byProject[projectPath] ?? EMPTY_EDITOR;
  const next = change(current);
  if (next === null || next === current) return null;
  return { byProject: { ...state.byProject, [projectPath]: next } };
}

/**
 * Complete each stored editor with the fields that never went to storage.
 *
 * Storage holds a third of an editor, and an entry written before this store
 * held a selected layer holds less than that. Filling every one from
 * [`EMPTY_EDITOR`] is what stops a read-back leaving `dirty` or `collapsed`
 * undefined, which the panels call methods on without checking.
 */
export function rehydrate(persisted: unknown): Record<string, ProjectEditor> {
  const stored = (persisted as { byProject?: Record<string, Partial<ProjectEditor>> } | null)
    ?.byProject;

  const byProject: Record<string, ProjectEditor> = {};
  for (const [path, editor] of Object.entries(stored ?? {})) {
    byProject[path] = { ...EMPTY_EDITOR, ...editor };
  }
  return byProject;
}

export const useWorkshopEditorStore = create<WorkshopEditorStore>()(
  persist(
    (set) => ({
      byProject: {},

      openDocument: (projectPath, document) =>
        set(
          (state) =>
            updateProject(state, projectPath, (editor) => {
              const known = editor.open.some((open) => open.id === document.id);
              return {
                ...editor,
                open: known ? editor.open : [...editor.open, document],
                activeId: document.id,
              };
            }) ?? state,
        ),

      activateDocument: (projectPath, id) =>
        set(
          (state) =>
            updateProject(state, projectPath, (editor) =>
              editor.activeId === id ? null : { ...editor, activeId: id },
            ) ?? state,
        ),

      closeDocument: (projectPath, id) =>
        set(
          (state) =>
            updateProject(state, projectPath, (editor) => {
              const index = editor.open.findIndex((document) => document.id === id);
              if (index < 0) return null;

              const dirty = new Set(editor.dirty);
              dirty.delete(id);

              return {
                ...editor,
                open: editor.open.filter((document) => document.id !== id),
                activeId:
                  editor.activeId === id ? neighbourOf(editor.open, index) : editor.activeId,
                dirty,
              };
            }) ?? state,
        ),

      reorderDocuments: (projectPath, ids) =>
        set(
          (state) =>
            updateProject(state, projectPath, (editor) => {
              const byId = new Map(editor.open.map((document) => [document.id, document] as const));
              const open = ids.flatMap((id) => {
                const document = byId.get(id);
                return document ? [document] : [];
              });

              /* A drop that started before a close lands with a stale list, which
                 would drop whatever the two disagree about. Keep the strip. */
              if (open.length !== editor.open.length) return null;
              return { ...editor, open };
            }) ?? state,
        ),

      setDocumentDirty: (projectPath, id, dirty) =>
        set(
          (state) =>
            updateProject(state, projectPath, (editor) => {
              if (editor.dirty.has(id) === dirty) return null;

              const next = new Set(editor.dirty);
              if (dirty) next.add(id);
              else next.delete(id);
              return { ...editor, dirty: next };
            }) ?? state,
        ),

      selectLayer: (projectPath, layerName) =>
        set(
          (state) =>
            updateProject(state, projectPath, (editor) =>
              editor.selectedLayer === layerName ? null : { ...editor, selectedLayer: layerName },
            ) ?? state,
        ),

      toggleCollapsed: (projectPath, layerName, path) =>
        set(
          (state) =>
            updateProject(state, projectPath, (editor) => {
              const next = new Set(editor.collapsed[layerName] ?? NO_COLLAPSED_DIRS);
              if (next.has(path)) next.delete(path);
              else next.add(path);

              return { ...editor, collapsed: { ...editor.collapsed, [layerName]: next } };
            }) ?? state,
        ),

      reveal: (projectPath, layerName, path) =>
        set(
          (state) =>
            updateProject(state, projectPath, (editor) => ({
              ...editor,
              reveal: { layerName, path, token: (editor.reveal?.token ?? 0) + 1 },
            })) ?? state,
        ),

      moveProject: (fromPath, toPath) =>
        set((state) => {
          const current = state.byProject[fromPath];
          if (!current || fromPath === toPath) return state;

          const byProject = { ...state.byProject };
          delete byProject[fromPath];
          byProject[toPath] = current;
          return { byProject };
        }),

      forgetProject: (projectPath) =>
        set((state) => {
          if (!(projectPath in state.byProject)) return state;

          const byProject = { ...state.byProject };
          delete byProject[projectPath];
          return { byProject };
        }),
    }),
    {
      /* The key predates the store's own name. Renaming it would read as a
         first run to everyone and throw away the strip they left open. */
      name: "ltk-workshop-documents",
      version: 1,
      partialize: (state) => ({
        byProject: Object.fromEntries(
          Object.entries(state.byProject).map(([path, editor]) => [
            path,
            { open: editor.open, activeId: editor.activeId, selectedLayer: editor.selectedLayer },
          ]),
        ),
      }),
      merge: (persisted, current) => ({ ...current, byProject: rehydrate(persisted) }),
    },
  ),
);
