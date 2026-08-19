import { create } from "zustand";

/* The layout sub-barrel rather than the module barrel: the full barrel pulls
   the editor's components, whose imports circle back into `@/stores`, and this
   module needs `singleLeaf` while it evaluates. */
import {
  type Edge,
  findLeaf,
  insertTab,
  type LayoutNode,
  leafHolding,
  leaves,
  mergeToSingleLeaf,
  moveTab,
  removeTab,
  setActiveTab,
  setSplitLayout as applySplitLayout,
  singleLeaf,
  splitLeaf,
} from "@/modules/editor/layout";
import type { ContentDocument, PersistedProjectEditor } from "@/modules/workshop";

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
 * `documents`, `layout`, `activeLeafId` and `selectedLayer` persist, written to
 * the project's own `.ltk/editor.json` by `useEditorPersistence`. The rest is
 * rebuilt each run: a dirty flag belongs to an editor that is currently
 * mounted, and neither the shut directories nor a pending scroll are worth
 * carrying across a restart.
 */
export interface ProjectEditor {
  /** Every open document, keyed by id. A leaf's tabs are ids into this map. */
  documents: Record<string, ContentDocument>;
  /** The split tree of editor groups. A single leaf until the user splits. */
  layout: LayoutNode;
  /** The leaf a newly opened document lands in. */
  activeLeafId: string;
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
  /** Installs a project's persisted slice, completing it with the memory-only fields. */
  hydrateProject: (projectPath: string, state: PersistedProjectEditor) => void;
  /** Opens into `leafId`, falling back to the focused leaf. A document already open activates where it is. */
  openDocument: (projectPath: string, document: ContentDocument, leafId?: string) => void;
  activateDocument: (projectPath: string, leafId: string, id: string) => void;
  closeDocument: (projectPath: string, leafId: string, id: string) => void;
  /** Rewrites one strip's order from a full list of its ids. */
  reorderDocuments: (projectPath: string, leafId: string, ids: readonly string[]) => void;
  moveDocument: (projectPath: string, documentId: string, toLeafId: string, index?: number) => void;
  splitWithDocument: (
    projectPath: string,
    documentId: string,
    targetLeafId: string,
    edge: Edge,
  ) => void;
  focusLeaf: (projectPath: string, leafId: string) => void;
  /** Writes what `onLayoutChanged` reported for one split. */
  setSplitLayout: (projectPath: string, splitId: string, layout: Record<string, number>) => void;
  /** Merges every strip into the focused leaf, in reading order. */
  resetLayout: (projectPath: string) => void;
  setDocumentDirty: (projectPath: string, id: string, dirty: boolean) => void;
  selectLayer: (projectPath: string, layerName: string) => void;
  toggleCollapsed: (projectPath: string, layerName: string, path: string) => void;
  reveal: (projectPath: string, layerName: string, path: string) => void;
  /** Follows a project whose path changed, so a rename keeps its editor. */
  moveProject: (fromPath: string, toPath: string) => void;
  /** Drops a deleted project, which would otherwise sit in storage forever. */
  forgetProject: (projectPath: string) => void;
}

/* Shared by every editor nothing has touched. Safe to share because every tree
   op copies before it writes. */
const ROOT = singleLeaf();

export const EMPTY_EDITOR: ProjectEditor = {
  documents: {},
  layout: ROOT,
  activeLeafId: ROOT.id,
  selectedLayer: null,
  dirty: new Set(),
  collapsed: {},
  reveal: null,
};

/** The collapsed-set of a layer nobody has shut a directory in. */
export const NO_COLLAPSED_DIRS: ReadonlySet<string> = new Set();

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

/*
 * Rewrite one strip in the order a drag settled on. Lives here rather than in
 * the tree module because it is the one op with a store-shaped guard: a drop
 * that started before a close lands with a stale list, which would drop
 * whatever the two disagree about, so a list that is not a permutation of the
 * strip keeps the strip.
 */
function reorderLeafTabs(node: LayoutNode, leafId: string, ids: readonly string[]): LayoutNode {
  if (node.kind === "leaf") {
    if (node.id !== leafId) return node;
    if (ids.length !== node.tabs.length || !ids.every((id) => node.tabs.includes(id))) return node;
    if (ids.every((id, index) => node.tabs[index] === id)) return node;
    return { ...node, tabs: [...ids] };
  }

  let changed = false;
  const children = node.children.map((child) => {
    const next = reorderLeafTabs(child, leafId, ids);
    if (next !== child) changed = true;
    return next;
  });
  return changed ? { ...node, children } : node;
}

export const useWorkshopEditorStore = create<WorkshopEditorStore>()((set) => ({
  byProject: {},

  hydrateProject: (projectPath, state) =>
    set((current) => ({
      byProject: {
        ...current.byProject,
        [projectPath]: {
          ...EMPTY_EDITOR,
          documents: state.documents,
          layout: state.layout,
          activeLeafId: state.activeLeafId,
          selectedLayer: state.selectedLayer,
        },
      },
    })),

  openDocument: (projectPath, document, leafId) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          const holder = leafHolding(editor.layout, document.id);
          if (holder) {
            /* Already open: activate where it is and keep the stored
               document, whose editor may hold state the argument lacks. */
            const layout = setActiveTab(editor.layout, holder.id, document.id);
            if (layout === editor.layout && editor.activeLeafId === holder.id) return null;
            return { ...editor, layout, activeLeafId: holder.id };
          }

          const requested = leafId ?? editor.activeLeafId;
          const target = findLeaf(editor.layout, requested) ?? leaves(editor.layout)[0];
          return {
            ...editor,
            documents: { ...editor.documents, [document.id]: document },
            layout: insertTab(editor.layout, target.id, document.id),
            activeLeafId: target.id,
          };
        }) ?? state,
    ),

  activateDocument: (projectPath, leafId, id) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          if (!findLeaf(editor.layout, leafId)) return null;
          const layout = setActiveTab(editor.layout, leafId, id);
          if (layout === editor.layout && editor.activeLeafId === leafId) return null;
          return { ...editor, layout, activeLeafId: leafId };
        }) ?? state,
    ),

  closeDocument: (projectPath, leafId, id) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          const layout = removeTab(editor.layout, leafId, id);
          if (layout === editor.layout) return null;

          const documents = { ...editor.documents };
          const dirty = new Set(editor.dirty);
          if (!leafHolding(layout, id)) {
            delete documents[id];
            dirty.delete(id);
          }

          /* Closing a leaf's last tab prunes it, which can take the
             focused leaf with it. */
          const activeLeafId = findLeaf(layout, editor.activeLeafId)
            ? editor.activeLeafId
            : leaves(layout)[0].id;

          return { ...editor, documents, layout, activeLeafId, dirty };
        }) ?? state,
    ),

  reorderDocuments: (projectPath, leafId, ids) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          const layout = reorderLeafTabs(editor.layout, leafId, ids);
          return layout === editor.layout ? null : { ...editor, layout };
        }) ?? state,
    ),

  moveDocument: (projectPath, documentId, toLeafId, index) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          const layout = moveTab(editor.layout, documentId, toLeafId, index);
          if (layout === editor.layout) return null;
          return { ...editor, layout, activeLeafId: toLeafId };
        }) ?? state,
    ),

  splitWithDocument: (projectPath, documentId, targetLeafId, edge) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          const split = splitLeaf(editor.layout, targetLeafId, edge, documentId);
          if (split.tree === editor.layout) return null;
          return { ...editor, layout: split.tree, activeLeafId: split.leafId };
        }) ?? state,
    ),

  focusLeaf: (projectPath, leafId) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          if (editor.activeLeafId === leafId || !findLeaf(editor.layout, leafId)) return null;
          return { ...editor, activeLeafId: leafId };
        }) ?? state,
    ),

  setSplitLayout: (projectPath, splitId, layout) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          const next = applySplitLayout(editor.layout, splitId, layout);
          return next === editor.layout ? null : { ...editor, layout: next };
        }) ?? state,
    ),

  resetLayout: (projectPath) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          const layout = mergeToSingleLeaf(editor.layout, editor.activeLeafId);
          if (layout === editor.layout) return null;
          return { ...editor, layout, activeLeafId: layout.id };
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
}));
