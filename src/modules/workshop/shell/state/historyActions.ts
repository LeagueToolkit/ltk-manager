/* The layout sub-barrel rather than the module barrel: the full barrel pulls
   the editor's components, whose imports circle back into workshop state. */
// eslint-disable-next-line no-restricted-imports -- the cycle the comment above names
import { findLeaf, leafHolding, setActiveTab } from "@/modules/editor/layout";

import type { EditorGet, EditorSet } from "./editorRoot";
import {
  type ExplorerStop,
  type HistoryEntry,
  type NavigationStack,
  placeStop,
  pushStop,
} from "./navigationStack";

/** What the navigation arrows walk: the stops the shell records, and the walk itself. */
export interface HistoryActions {
  /** Records the list as a stop, which is what a back out of a project lands on. */
  recordListVisit: () => void;
  /**
   * Record the open tab of a project being entered, unless the arrows already stand in it.
   *
   * A project that restores its tabs opens none, so without this stop a back out of it
   * has nothing to return from.
   */
  recordProjectVisit: (project: string) => void;
  /**
   * Record where an explorer is standing, as a stop of its own.
   *
   * The first one completes the stop its tab's own open recorded, so a tab and
   * the directory it opened at are one stop rather than two.
   */
  recordLocationVisit: (project: string, documentId: string, location: ExplorerStop) => void;
  /**
   * Lay the route down to where an explorer opens, if the tab has none yet.
   *
   * A location belongs to its explorer rather than to the tab drawing it, so a
   * tab can open several directories deep having walked no route there. These
   * are the stops that walk it back out. Recorded once per open, because a
   * remount is not a second open.
   */
  openLocationStops: (project: string, documentId: string, stops: readonly ExplorerStop[]) => void;
  /**
   * Walks the history by `delta` without recording the stop it lands on.
   *
   * Returns the stop it reached, because one in another project is a route
   * change and a store cannot make one.
   */
  navigateHistory: (delta: number) => HistoryEntry | null;
}

/** These actions, closed over the writer of the store that holds them. */
export function createHistoryActions(set: EditorSet, get: EditorGet): HistoryActions {
  return {
    recordListVisit: () => set((state) => pushStop(state, { kind: "list" }) ?? state),

    recordProjectVisit: (project) =>
      set((state) => {
        const current = state.history[state.historyIndex];
        if (current?.kind === "document" && current.project === project) return state;

        const editor = state.byProject[project];
        const documentId = editor ? findLeaf(editor.layout, editor.activeLeafId)?.activeTab : null;
        if (!documentId) return state;

        return pushStop(state, { kind: "document", project, documentId }) ?? state;
      }),

    recordLocationVisit: (project, documentId, location) =>
      set((state) => placeStop(state, { kind: "document", project, documentId, location })),

    openLocationStops: (project, documentId, stops) =>
      set((state) => {
        /* Written once, when the tab's own stop still names no directory of it.
           A mount is not a navigation: an explorer remounts whenever its route
           does, and a remount that laid these down again would drop whatever the
           arrows had ahead of them and stand two junk stops in its place. */
        const placed = state.history.some(
          (entry) =>
            entry.kind === "document" &&
            entry.project === project &&
            entry.documentId === documentId &&
            entry.location !== undefined,
        );
        if (placed) return state;

        return stops.reduce<NavigationStack>(
          (stack, location) =>
            placeStop(stack, { kind: "document", project, documentId, location }),
          state,
        );
      }),

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
  };
}
