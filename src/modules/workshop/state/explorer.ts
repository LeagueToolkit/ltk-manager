import { create } from "zustand";

import type { ExplorerScope } from "../explorer/ExplorerSearchBox";
import { type ExplorerFilter, NO_FILTER } from "../explorer/filter";
import { NO_SELECTION, type Selection } from "../explorer/selection";

interface ExplorerStore {
  /** Where each explorer is, by its id. Absent reads as the root. */
  locations: Record<string, string>;
  goTo: (explorerId: string, location: string) => void;
  /** What each explorer's box reads, by its id. Absent reads the open directory. */
  scopes: Record<string, ExplorerScope>;
  setScope: (explorerId: string, scope: ExplorerScope) => void;
  /** What each explorer's box and menu hold, by its id. */
  filters: Record<string, ExplorerFilter>;
  setFilter: (explorerId: string, filter: ExplorerFilter) => void;
  /** What each explorer has selected, by its id. */
  selections: Record<string, Selection>;
  setSelection: (explorerId: string, selection: Selection) => void;
}

/**
 * Where each explorer is, what it is narrowed to, and what it has selected.
 *
 * Outside the documents that draw it, for the reason the game browser's own
 * store gives: the first preview a row opens splits a group off beside it, and
 * a leaf that gains a split around it remounts everything under it. A document
 * holding its own location would land back at the root on the very double click
 * that opened the file.
 *
 * Nothing here is persisted. A filter answers one question and is gone by the
 * next open, and a selection feeds one copy, which a restart has none of.
 */
export const useExplorerStore = create<ExplorerStore>()((set) => ({
  locations: {},
  goTo: (explorerId, location) =>
    set((state) => ({ locations: { ...state.locations, [explorerId]: location } })),
  scopes: {},
  setScope: (explorerId, scope) =>
    set((state) => ({ scopes: { ...state.scopes, [explorerId]: scope } })),
  filters: {},
  setFilter: (explorerId, filter) =>
    set((state) => ({ filters: { ...state.filters, [explorerId]: filter } })),
  selections: {},
  setSelection: (explorerId, selection) =>
    set((state) => ({ selections: { ...state.selections, [explorerId]: selection } })),
}));

/**
 * Put an explorer back where a history stop says it was.
 *
 * Records nothing, because the arrows are walking the stack rather than adding
 * to it. Outside React for the reason `keptScrollTop` is: the caller is an
 * event handler, not a render.
 */
export function restoreLocation(explorerId: string, location: string): void {
  const store = useExplorerStore.getState();
  store.goTo(explorerId, location);
  store.setSelection(explorerId, NO_SELECTION);
}

export const useExplorerLocation = (explorerId: string) =>
  useExplorerStore((s) => s.locations[explorerId] ?? "");
export const useGoToLocation = () => useExplorerStore((s) => s.goTo);
export const useExplorerScope = (explorerId: string) =>
  useExplorerStore((s) => s.scopes[explorerId] ?? "here");
export const useSetExplorerScope = () => useExplorerStore((s) => s.setScope);
export const useExplorerFilter = (explorerId: string) =>
  useExplorerStore((s) => s.filters[explorerId] ?? NO_FILTER);
export const useSetExplorerFilter = () => useExplorerStore((s) => s.setFilter);
export const useExplorerSelection = (explorerId: string) =>
  useExplorerStore((s) => s.selections[explorerId] ?? NO_SELECTION);
export const useSetExplorerSelection = () => useExplorerStore((s) => s.setSelection);
