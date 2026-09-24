/* The layout sub-barrel rather than the module barrel: the full barrel pulls
   the editor's components, whose imports circle back into workshop state. */
// eslint-disable-next-line no-restricted-imports -- the cycle the comment above names
import {
  acceptsOpen,
  type Edge,
  findLeaf,
  insertTab,
  leafHolding,
  leaves,
  moveTab,
  removeTab,
  replaceTab,
  setActiveTab,
  splitEmpty,
  splitLeaf,
} from "@/modules/editor/layout";

import type { PersistedProjectEditor } from "../../bin/documents/state/editorFile";
import { type ContentDocument, documentLayerName } from "../../documents/utils/contentDocument";
import { openGroup } from "./documentPlacement";
import type { EditorGet, EditorSet } from "./editorRoot";
import { withoutPreviewDocument, withPreview } from "./previewTabs";
import { EMPTY_EDITOR } from "./projectEditor";
import {
  afterRemoval,
  forgetVisits,
  recordVisit,
  setProject,
  updateProject,
} from "./projectUpdate";
import { atPinnedBoundary, clampToPinnedRun, pinnedFirst, reorderLeafTabs } from "./tabOrder";

/** What the editor does to the documents it holds: open, close, place and reopen. */
export interface DocumentActions {
  /** Asks `projectPath`'s editor to open `document` once it can. */
  requestDocument: (projectPath: string, document: ContentDocument) => void;
  /** Takes the pending document, if there is one, and clears it. */
  takePendingDocument: (projectPath: string) => ContentDocument | null;
  /** Installs a project's persisted slice, completing it with the memory-only fields. */
  hydrateProject: (projectPath: string, state: PersistedProjectEditor) => void;
  /** Opens into `leafId`, falling back to the focused leaf. A document already open activates where it is. */
  openDocument: (projectPath: string, document: ContentDocument, leafId?: string) => void;
  /** Opens as the ephemeral tab, replacing the one its own group holds. */
  openPreview: (projectPath: string, document: ContentDocument, leafId?: string) => void;
  /** Makes a document permanent, which is what a double click asks for. */
  promoteDocument: (projectPath: string, id: string) => void;
  /** Pins or unpins one document, which moves it to the divider of its own strip. */
  setDocumentPinned: (projectPath: string, id: string, pinned: boolean) => void;
  activateDocument: (projectPath: string, leafId: string, id: string) => void;
  closeDocument: (projectPath: string, leafId: string, id: string) => void;
  /**
   * Puts the newest tab this project closed back, and returns it.
   *
   * Lands in the group it was closed from while the tree still holds that
   * group, and in the focused group where a prune took it. Returns null while
   * the project has closed nothing.
   */
  reopenClosedDocument: (projectPath: string) => ContentDocument | null;
  /**
   * Closes every document scoped to one layer, in whichever group holds it.
   *
   * What a layer delete asks for: the layer is gone, so its file tree, its
   * locales and every preview of its files have nothing left to read.
   */
  closeLayerDocuments: (projectPath: string, layerName: string) => void;
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
  setDocumentDirty: (projectPath: string, id: string, dirty: boolean) => void;
}

/** These actions, closed over the writer of the store that holds them. */
export function createDocumentActions(set: EditorSet, get: EditorGet): DocumentActions {
  return {
    requestDocument: (projectPath, document) =>
      set((current) => ({
        pendingDocuments: { ...current.pendingDocuments, [projectPath]: document },
      })),

    takePendingDocument: (projectPath) => {
      const pending = get().pendingDocuments[projectPath];
      if (!pending) return null;

      set((current) => {
        const { [projectPath]: _taken, ...rest } = current.pendingDocuments;
        return { pendingDocuments: rest };
      });
      return pending;
    },

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
            useDeclarations: state.useDeclarations,
            selectedModule: state.selectedModule ?? null,
            previewIds: state.previewIds,
            pinned: state.pinned,
            shells: state.shells,
            abilities: state.abilities,
          },
        },
      })),

    openDocument: (projectPath, document, leafId) =>
      setProject(set, projectPath, (editor) => {
        const holder = leafHolding(editor.layout, document.id);
        if (holder) {
          /* Already open: activate where it is and keep the stored
             document, whose editor may hold state the argument lacks. An
             open that lands on the preview promotes it, which is what makes
             "open it properly" one gesture rather than two. */
          const layout = setActiveTab(editor.layout, holder.id, document.id);
          const previewIds = withoutPreviewDocument(editor.previewIds, document.id);
          if (
            layout === editor.layout &&
            editor.activeLeafId === holder.id &&
            previewIds === editor.previewIds
          ) {
            return recordVisit(editor, document.id);
          }
          return recordVisit(
            { ...editor, layout, activeLeafId: holder.id, previewIds },
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
      }),

    openPreview: (projectPath, document, leafId) =>
      setProject(set, projectPath, (editor) => {
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
        const group = openGroup(editor, document, leafId);
        const target = findLeaf(group.layout, group.leafId);
        const replaced = editor.previewIds[group.leafId];

        /* The group the open lands in holds the tab it replaces. A group the
           open never reaches keeps its own, which is what makes a walk
           through a tree in one group leave another group alone.

           A lock makes that group's preview tab permanent: the replacement
           cannot land there, so the tab it would have taken stays put. */
        if (replaced !== undefined && target && acceptsOpen(target)) {
          const layout = replaceTab(group.layout, group.leafId, replaced, document.id);
          if (layout !== group.layout) {
            delete documents[replaced];
            /* Forgotten rather than closed, per "Reopening a closed tab" in
               `docs/ux/PROJECT_EDITOR.md`. */
            return recordVisit(
              forgetVisits(
                {
                  ...editor,
                  documents,
                  layout,
                  activeLeafId: group.leafId,
                  previewIds: withPreview(editor.previewIds, group.leafId, document.id),
                },
                [replaced],
              ),
              document.id,
            );
          }
        }

        return recordVisit(
          {
            ...editor,
            documents,
            layout: insertTab(group.layout, group.leafId, document.id),
            activeLeafId: group.leafId,
            previewIds: withPreview(editor.previewIds, group.leafId, document.id),
          },
          document.id,
        );
      }),

    promoteDocument: (projectPath, id) =>
      setProject(set, projectPath, (editor) => {
        const previewIds = withoutPreviewDocument(editor.previewIds, id);
        return previewIds === editor.previewIds ? null : { ...editor, previewIds };
      }),

    setDocumentPinned: (projectPath, id, pinned) =>
      setProject(set, projectPath, (editor) => {
        const holder = leafHolding(editor.layout, id);
        if (!holder || editor.pinned.includes(id) === pinned) return null;

        const next = pinned
          ? [...editor.pinned, id]
          : editor.pinned.filter((candidate) => candidate !== id);
        const layout = reorderLeafTabs(
          editor.layout,
          holder.id,
          atPinnedBoundary(holder, id, next),
        );

        /* A pin is what says the tab is worth keeping, so it cannot stay the
           one the next open replaces. */
        const previewIds = pinned
          ? withoutPreviewDocument(editor.previewIds, id)
          : editor.previewIds;
        return { ...editor, layout, pinned: next, previewIds };
      }),

    activateDocument: (projectPath, leafId, id) =>
      setProject(set, projectPath, (editor) => {
        if (!findLeaf(editor.layout, leafId)) return null;
        const layout = setActiveTab(editor.layout, leafId, id);
        if (layout === editor.layout && editor.activeLeafId === leafId) {
          return recordVisit(editor, id);
        }
        return recordVisit({ ...editor, layout, activeLeafId: leafId }, id);
      }),

    closeDocument: (projectPath, leafId, id) =>
      setProject(set, projectPath, (editor) => {
        const layout = removeTab(editor.layout, leafId, id);
        if (layout === editor.layout) return null;
        return afterRemoval(editor, layout, [id]);
      }),

    reopenClosedDocument: (projectPath) => {
      const entry = get().closed.find((tab) => tab.project === projectPath);
      if (!entry) return null;

      set((state) => {
        const closed = state.closed.filter((tab) => tab !== entry);
        const reopened = updateProject(state, projectPath, (editor) => {
          const { document } = entry;

          /* Reopened by hand while the list still named it: the tab is the one
             that stands, and the list drops the entry either way. */
          const holder = leafHolding(editor.layout, document.id);
          if (holder) {
            return recordVisit(
              {
                ...editor,
                layout: setActiveTab(editor.layout, holder.id, document.id),
                activeLeafId: holder.id,
              },
              document.id,
            );
          }

          const target =
            findLeaf(editor.layout, entry.leafId) ??
            findLeaf(editor.layout, editor.activeLeafId) ??
            leaves(editor.layout)[0];

          /* Permanent and pinned as it was, per "Reopening a closed tab" in
             `docs/ux/PROJECT_EDITOR.md`. */
          const pinned =
            entry.pinned && !editor.pinned.includes(document.id)
              ? [...editor.pinned, document.id]
              : editor.pinned;
          const inserted = insertTab(editor.layout, target.id, document.id);
          const leaf = findLeaf(inserted, target.id);
          const layout =
            leaf && pinned !== editor.pinned
              ? reorderLeafTabs(inserted, target.id, pinnedFirst(leaf.tabs, pinned))
              : inserted;

          return recordVisit(
            {
              ...editor,
              documents: { ...editor.documents, [document.id]: document },
              layout,
              activeLeafId: target.id,
              pinned,
            },
            document.id,
          );
        });
        return { ...state, ...reopened, closed };
      });
      return entry.document;
    },

    closeLayerDocuments: (projectPath, layerName) =>
      setProject(set, projectPath, (editor) => {
        const scoped = Object.values(editor.documents)
          .filter((document) => documentLayerName(document) === layerName)
          .map((document) => document.id);
        if (scoped.length === 0) return null;

        /* Through the store rather than through one strip, so the close
           reaches whichever group each tab ended up in. */
        let layout = editor.layout;
        for (const id of scoped) {
          const holder = leafHolding(layout, id);
          if (holder) layout = removeTab(layout, holder.id, id);
        }
        if (layout === editor.layout) return null;

        return afterRemoval(editor, layout, scoped, "gone");
      }),

    reorderDocuments: (projectPath, leafId, ids) =>
      setProject(set, projectPath, (editor) => {
        const layout = reorderLeafTabs(editor.layout, leafId, pinnedFirst(ids, editor.pinned));
        return layout === editor.layout ? null : { ...editor, layout };
      }),

    moveDocument: (projectPath, documentId, toLeafId, index) =>
      setProject(set, projectPath, (editor) => {
        const target = findLeaf(editor.layout, toLeafId);
        if (!target) return null;

        const at = clampToPinnedRun(
          target.tabs,
          documentId,
          index ?? target.tabs.length,
          editor.pinned,
        );
        const layout = moveTab(editor.layout, documentId, toLeafId, at);
        if (layout === editor.layout) return null;

        /* A move into another group is a deliberate placement, which says the
           document is worth keeping. A reorder inside one strip goes through
           `reorderDocuments` and leaves the role alone, since the tab did not
           go anywhere. */
        const moved = leafHolding(editor.layout, documentId)?.id !== toLeafId;
        return {
          ...editor,
          layout,
          activeLeafId: toLeafId,
          previewIds: moved
            ? withoutPreviewDocument(editor.previewIds, documentId)
            : editor.previewIds,
        };
      }),

    splitWithDocument: (projectPath, documentId, targetLeafId, edge) =>
      setProject(set, projectPath, (editor) => {
        const split = splitLeaf(editor.layout, targetLeafId, edge, documentId);
        if (split.tree === editor.layout) return null;

        /* A split with the tab places it in a group of its own, which is the
           same deliberate placement a move is. */
        return {
          ...editor,
          layout: split.tree,
          activeLeafId: split.leafId,
          previewIds: withoutPreviewDocument(editor.previewIds, documentId),
        };
      }),

    openDocumentBeside: (projectPath, document) =>
      setProject(set, projectPath, (editor) => {
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
      }),

    setDocumentDirty: (projectPath, id, dirty) =>
      setProject(set, projectPath, (editor) => {
        if (editor.dirty.has(id) === dirty) return null;

        const next = new Set(editor.dirty);
        if (dirty) next.add(id);
        else next.delete(id);
        return { ...editor, dirty: next };
      }),
  };
}
