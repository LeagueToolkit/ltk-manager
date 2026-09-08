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
  replaceTab,
  setActiveTab,
  setSplitLayout as applySplitLayout,
  singleLeaf,
  splitEmpty,
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

/** The palette's request that one open bin scroll to an object it declares. */
export interface ObjectRevealRequest {
  readonly documentId: string;
  /** `0x` and eight hex digits. */
  readonly objectHash: string;
  /** Bumped per request. A second request for the same object is a second scroll. */
  readonly token: number;
}

/**
 * One stop on the shell's navigation history.
 *
 * The stack spans the workshop rather than one project, so a stop names where
 * it was as well as what it was. The group is not recorded, because a document
 * sits in exactly one of them and `leafHolding` answers which. A position
 * inside the document is not recorded either, so a back restores which document
 * and leaves the rest to it.
 */
export type HistoryEntry =
  | { readonly kind: "list" }
  | {
      readonly kind: "document";
      /** The path of the project holding it, which is what the arrows route to. */
      readonly project: string;
      readonly documentId: string;
    };

/** How far back the arrows reach before the oldest stop is dropped. */
const HISTORY_LIMIT = 50;

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
  /**
   * The one ephemeral tab, which the next open replaces.
   *
   * Null unless the user asked for the `replace` tab mode. One per project
   * rather than per leaf, so a preview opened from a second editor group
   * replaces the first group's rather than joining it.
   */
  previewId: string | null;
  /** Ids with unsaved edits. Editors report their own. */
  dirty: ReadonlySet<string>;
  /** Directories the user shut, per layer name. Anything absent is open. */
  collapsed: Record<string, ReadonlySet<string>>;
  /** The pending scroll request, which at most one layer's tree answers. */
  reveal: RevealRequest | null;
  /** The pending object request, which at most one open bin answers. */
  revealObject: ObjectRevealRequest | null;
}

interface WorkshopEditorStore {
  /** Editor state per project path, so switching projects keeps every set. */
  byProject: Record<string, ProjectEditor>;
  /**
   * Where the user has been across the shell, oldest first.
   *
   * One stack rather than one per project, so the arrows walk out of a project
   * the same way they walk between its tabs. Session-only: `.ltk/editor.json`
   * holds where a user left a project, and a history is how they got there.
   */
  history: readonly HistoryEntry[];
  /** Where in `history` the arrows stand. -1 while nothing has been visited. */
  historyIndex: number;
  /** Installs a project's persisted slice, completing it with the memory-only fields. */
  hydrateProject: (projectPath: string, state: PersistedProjectEditor) => void;
  /** Opens into `leafId`, falling back to the focused leaf. A document already open activates where it is. */
  openDocument: (projectPath: string, document: ContentDocument, leafId?: string) => void;
  /** Opens as the ephemeral tab, replacing whichever one holds that role. */
  openPreview: (projectPath: string, document: ContentDocument, leafId?: string) => void;
  /** Makes a document permanent, which is what a double click asks for. */
  promoteDocument: (projectPath: string, id: string) => void;
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
  /** Opens into a fresh group beside the focused one, which `Ctrl+Enter` asks for. */
  openDocumentBeside: (projectPath: string, document: ContentDocument) => void;
  focusLeaf: (projectPath: string, leafId: string) => void;
  /** Records the list as a stop, which is what a back out of a project lands on. */
  recordListVisit: () => void;
  /**
   * Walks the history by `delta` without recording the stop it lands on.
   *
   * Returns the stop it reached, because one in another project is a route
   * change and a store cannot make one.
   */
  navigateHistory: (delta: number) => HistoryEntry | null;
  /** Writes what `onLayoutChanged` reported for one split. */
  setSplitLayout: (projectPath: string, splitId: string, layout: Record<string, number>) => void;
  /** Merges every strip into the focused leaf, in reading order. */
  resetLayout: (projectPath: string) => void;
  setDocumentDirty: (projectPath: string, id: string, dirty: boolean) => void;
  selectLayer: (projectPath: string, layerName: string) => void;
  toggleCollapsed: (projectPath: string, layerName: string, path: string) => void;
  reveal: (projectPath: string, layerName: string, path: string) => void;
  revealObject: (projectPath: string, documentId: string, objectHash: string) => void;
  /** Drops the object request with `token`. A settled request reaches no later open. */
  settleObjectReveal: (projectPath: string, token: number) => void;
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
  previewId: null,
  dirty: new Set(),
  collapsed: {},
  reveal: null,
  revealObject: null,
};

/** The collapsed-set of a layer nobody has shut a directory in. */
export const NO_COLLAPSED_DIRS: ReadonlySet<string> = new Set();

/** The shell's stack, apart from the editors the stops point into. */
type Stack = Pick<WorkshopEditorStore, "history" | "historyIndex">;

/**
 * What one action left behind: the editor, and what it did to the stack.
 *
 * The stack sits on the store root, so an action working inside one project's
 * slice cannot write it. It tags what it did instead, and `updateProject` folds
 * the tag into the shell's stack with the project the action was given.
 */
interface EditorMove {
  readonly editor: ProjectEditor;
  /** The document the action landed on, which the stack records. */
  readonly visited?: string;
  /** A document that is gone, whose stops the stack drops. */
  readonly forgotten?: string;
}

function asMove(target: ProjectEditor | EditorMove): EditorMove {
  return "editor" in target ? target : { editor: target };
}

/**
 * Apply a change to one project's editor, or report that nothing moved.
 *
 * Returning `null` lets the caller hand `set` the state object it was given.
 * Zustand compares by identity, so that is what makes an unchanged action skip
 * every subscriber rather than waking them with an equal value. An action that
 * only moved the stack still counts as a change, which is what records a route
 * onto the document a group is already showing.
 */
function updateProject(
  state: WorkshopEditorStore,
  projectPath: string,
  change: (editor: ProjectEditor) => ProjectEditor | EditorMove | null,
): Partial<WorkshopEditorStore> | null {
  const current = state.byProject[projectPath] ?? EMPTY_EDITOR;
  const result = change(current);
  if (result === null) return null;

  const move = asMove(result);
  const stack = foldStack(state, projectPath, move);
  const moved = move.editor !== current;
  if (!moved && stack === null) return null;

  return {
    ...(moved ? { byProject: { ...state.byProject, [projectPath]: move.editor } } : null),
    ...stack,
  };
}

/* Forgotten before visited, so replacing a preview drops the tab it stood on
   and then records the one that took its place. */
function foldStack(stack: Stack, project: string, move: EditorMove): Stack | null {
  let next: Stack | null = null;

  if (move.forgotten !== undefined) {
    const documentId = move.forgotten;
    next = dropStops(
      stack,
      (entry) =>
        entry.kind === "document" && entry.project === project && entry.documentId === documentId,
    );
  }

  if (move.visited !== undefined) {
    next = pushStop(next ?? stack, { kind: "document", project, documentId: move.visited }) ?? next;
  }

  return next;
}

/**
 * Tag the document a route just landed on, for the stack to record.
 *
 * Tagged inside the store actions rather than at their call sites, so a route
 * into a document cannot forget to report itself.
 */
function recordVisit(target: ProjectEditor | EditorMove, documentId: string): EditorMove {
  return { ...asMove(target), visited: documentId };
}

/** Tag a closed document, so a back never lands on a tab that is gone. */
function forgetVisits(target: ProjectEditor | EditorMove, documentId: string): EditorMove {
  return { ...asMove(target), forgotten: documentId };
}

/**
 * Push a stop, or leave the stack standing where it is.
 *
 * Landing again on the stop the arrows already stand on records nothing, which
 * is what keeps a re-activate of the open tab, and a return to the list a back
 * already reached, out of the stack.
 */
function pushStop(stack: Stack, entry: HistoryEntry): Stack | null {
  if (sameStop(stack.history[stack.historyIndex], entry)) return null;

  /* A move after a back drops the forward part, the way a browser does. */
  const history = stack.history.slice(0, stack.historyIndex + 1);
  history.push(entry);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);

  return { history, historyIndex: history.length - 1 };
}

function sameStop(a: HistoryEntry | undefined, b: HistoryEntry): boolean {
  if (a === undefined) return false;
  if (a.kind === "list" || b.kind === "list") return a.kind === b.kind;
  return a.project === b.project && a.documentId === b.documentId;
}

/** Drop the stops a predicate names, keeping the arrows inside what is left. */
function dropStops(stack: Stack, gone: (entry: HistoryEntry) => boolean): Stack | null {
  if (!stack.history.some(gone)) return null;

  const history: HistoryEntry[] = [];
  let index = stack.historyIndex;
  stack.history.forEach((entry, at) => {
    if (!gone(entry)) {
      history.push(entry);
      return;
    }
    if (at <= stack.historyIndex) index -= 1;
  });

  return { history, historyIndex: Math.max(-1, Math.min(index, history.length - 1)) };
}

/* An object tab is a preview document: ADR-0028. */
function isPreviewKind(kind: ContentDocument["kind"]): boolean {
  return kind === "preview" || kind === "object";
}

/**
 * The group a document opens into, with the layout that holds it.
 *
 * An explicit `leafId` wins, and anything that is not a preview lands in the
 * focused group. Previews gather in one group beside whoever asked for them, so
 * a browser keeps its own group and a walk through a tree never pushes it off
 * screen. The first preview splits that group off, and every later one joins
 * the group it left behind.
 */
function openGroup(
  editor: ProjectEditor,
  document: ContentDocument,
  leafId?: string,
): { layout: LayoutNode; leafId: string } {
  const focused =
    findLeaf(editor.layout, leafId ?? editor.activeLeafId) ?? leaves(editor.layout)[0];
  if (leafId !== undefined || !isPreviewKind(document.kind)) {
    return { layout: editor.layout, leafId: focused.id };
  }

  const previews = leaves(editor.layout).find((leaf) =>
    leaf.tabs.some((id) => {
      const kind = editor.documents[id]?.kind;
      return kind !== undefined && isPreviewKind(kind);
    }),
  );
  if (previews) return { layout: editor.layout, leafId: previews.id };

  /* An empty group has nothing to sit beside, so it takes the preview rather
     than splitting into two with one of them showing nothing. */
  if (focused.tabs.length === 0) return { layout: editor.layout, leafId: focused.id };

  const split = splitEmpty(editor.layout, focused.id, "right");
  return { layout: split.tree, leafId: split.leafId };
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

export const useWorkshopEditorStore = create<WorkshopEditorStore>()((set, get) => ({
  byProject: {},
  history: [],
  historyIndex: -1,

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
          previewId: state.previewId,
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
               document, whose editor may hold state the argument lacks. An
               open that lands on the preview promotes it, which is what makes
               "open it properly" one gesture rather than two. */
            const layout = setActiveTab(editor.layout, holder.id, document.id);
            const previewId = editor.previewId === document.id ? null : editor.previewId;
            if (
              layout === editor.layout &&
              editor.activeLeafId === holder.id &&
              previewId === editor.previewId
            ) {
              return recordVisit(editor, document.id);
            }
            return recordVisit(
              { ...editor, layout, activeLeafId: holder.id, previewId },
              document.id,
            );
          }

          const group = openGroup(editor, document, leafId);
          return recordVisit(
            {
              ...editor,
              documents: { ...editor.documents, [document.id]: document },
              layout: insertTab(group.layout, group.leafId, document.id),
              activeLeafId: group.leafId,
            },
            document.id,
          );
        }) ?? state,
    ),

  openPreview: (projectPath, document, leafId) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          /* Already on screen: activate it and leave its role alone, so
             asking for the same file twice does not churn the tree. */
          const holder = leafHolding(editor.layout, document.id);
          if (holder) {
            const layout = setActiveTab(editor.layout, holder.id, document.id);
            if (layout === editor.layout && editor.activeLeafId === holder.id) {
              return recordVisit(editor, document.id);
            }
            return recordVisit({ ...editor, layout, activeLeafId: holder.id }, document.id);
          }

          const documents = { ...editor.documents, [document.id]: document };
          const previous = editor.previewId ? leafHolding(editor.layout, editor.previewId) : null;

          if (previous && editor.previewId) {
            const layout = replaceTab(editor.layout, previous.id, editor.previewId, document.id);
            if (layout !== editor.layout) {
              const replaced = editor.previewId;
              delete documents[replaced];
              return recordVisit(
                forgetVisits(
                  {
                    ...editor,
                    documents,
                    layout,
                    activeLeafId: previous.id,
                    previewId: document.id,
                  },
                  replaced,
                ),
                document.id,
              );
            }
          }

          const group = openGroup(editor, document, leafId);
          return recordVisit(
            {
              ...editor,
              documents,
              layout: insertTab(group.layout, group.leafId, document.id),
              activeLeafId: group.leafId,
              previewId: document.id,
            },
            document.id,
          );
        }) ?? state,
    ),

  promoteDocument: (projectPath, id) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) =>
          editor.previewId === id ? { ...editor, previewId: null } : null,
        ) ?? state,
    ),

  activateDocument: (projectPath, leafId, id) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          if (!findLeaf(editor.layout, leafId)) return null;
          const layout = setActiveTab(editor.layout, leafId, id);
          if (layout === editor.layout && editor.activeLeafId === leafId) {
            return recordVisit(editor, id);
          }
          return recordVisit({ ...editor, layout, activeLeafId: leafId }, id);
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
          const previewId = editor.previewId === id ? null : editor.previewId;

          /* Closing a leaf's last tab prunes it, which can take the
             focused leaf with it. */
          const activeLeafId = findLeaf(layout, editor.activeLeafId)
            ? editor.activeLeafId
            : leaves(layout)[0].id;

          return forgetVisits({ ...editor, documents, layout, activeLeafId, dirty, previewId }, id);
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

  openDocumentBeside: (projectPath, document) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          const focused = findLeaf(editor.layout, editor.activeLeafId) ?? leaves(editor.layout)[0];

          /* An empty group has nothing to sit beside, so it takes the document
             rather than splitting into two with one of them showing nothing. */
          if (focused.tabs.length === 0) {
            return recordVisit(
              {
                ...editor,
                documents: { ...editor.documents, [document.id]: document },
                layout: insertTab(editor.layout, focused.id, document.id),
                activeLeafId: focused.id,
              },
              document.id,
            );
          }

          if (leafHolding(editor.layout, document.id)) {
            const split = splitLeaf(editor.layout, focused.id, "right", document.id);
            if (split.tree === editor.layout) return recordVisit(editor, document.id);
            return recordVisit(
              { ...editor, layout: split.tree, activeLeafId: split.leafId },
              document.id,
            );
          }

          const split = splitEmpty(editor.layout, focused.id, "right");
          return recordVisit(
            {
              ...editor,
              documents: { ...editor.documents, [document.id]: document },
              layout: insertTab(split.tree, split.leafId, document.id),
              activeLeafId: split.leafId,
            },
            document.id,
          );
        }) ?? state,
    ),

  focusLeaf: (projectPath, leafId) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => {
          const leaf = findLeaf(editor.layout, leafId);
          if (!leaf || editor.activeLeafId === leafId) return null;

          const focused = { ...editor, activeLeafId: leafId };
          return leaf.activeTab ? recordVisit(focused, leaf.activeTab) : focused;
        }) ?? state,
    ),

  recordListVisit: () => set((state) => pushStop(state, { kind: "list" }) ?? state),

  navigateHistory: (delta) => {
    const state = get();
    const at = state.historyIndex + delta;
    const entry = state.history[at];
    if (!entry) return null;

    if (entry.kind === "list") {
      set({ historyIndex: at });
      return entry;
    }

    /* A stop whose tab is gone is skipped rather than repaired: `dropStops`
       clears a close, and what is left is a project the shell has forgotten. */
    const editor = state.byProject[entry.project];
    const holder = editor ? leafHolding(editor.layout, entry.documentId) : null;
    if (!editor || !holder) return null;

    set({
      byProject: {
        ...state.byProject,
        [entry.project]: {
          ...editor,
          layout: setActiveTab(editor.layout, holder.id, entry.documentId),
          activeLeafId: holder.id,
        },
      },
      historyIndex: at,
    });
    return entry;
  },

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

  revealObject: (projectPath, documentId, objectHash) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) => ({
          ...editor,
          revealObject: {
            documentId,
            objectHash,
            token: (editor.revealObject?.token ?? 0) + 1,
          },
        })) ?? state,
    ),

  settleObjectReveal: (projectPath, token) =>
    set(
      (state) =>
        updateProject(state, projectPath, (editor) =>
          editor.revealObject?.token === token ? { ...editor, revealObject: null } : editor,
        ) ?? state,
    ),

  moveProject: (fromPath, toPath) =>
    set((state) => {
      const current = state.byProject[fromPath];
      if (!current || fromPath === toPath) return state;

      const byProject = { ...state.byProject };
      delete byProject[fromPath];
      byProject[toPath] = current;

      /* The stops keep pointing at the editor they were recorded in, which the
         rename moved rather than replaced. */
      const history = state.history.map((entry) =>
        entry.kind === "document" && entry.project === fromPath
          ? { ...entry, project: toPath }
          : entry,
      );
      return { byProject, history };
    }),

  forgetProject: (projectPath) =>
    set((state) => {
      if (!(projectPath in state.byProject)) return state;

      const byProject = { ...state.byProject };
      delete byProject[projectPath];
      const stack = dropStops(
        state,
        (entry) => entry.kind === "document" && entry.project === projectPath,
      );
      return { byProject, ...stack };
    }),
}));
