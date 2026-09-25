import { create } from "zustand";

import { ancestorPrefixes, type ObjectTreeNode } from "../utils/objectTree";

/** A row the objects browser is asked to expand to, focus and scroll to. */
export interface ObjectsReveal {
  /** The object's path, which is its row's key. */
  readonly path: string;
  /** Bumped per request. Two reveals of one row both land. */
  readonly token: number;
}

interface ObjectsBrowserStore {
  selected: { path: string; type: "object" | "prefix" } | null;
  selectNode: (node: Pick<ObjectTreeNode, "id" | "type">) => void;
  setView: (view: "tree" | "grid") => void;
  display: { view: "tree" | "grid"; thumbnails: boolean; location: string; tileSize: number };
  setDisplay: (display: Partial<ObjectsBrowserStore["display"]>) => void;
  revealToken: number;
  /** Prefixes the user has opened in the objects tree, by path. */
  expandedPrefixes: ReadonlySet<string>;
  togglePrefix: (path: string) => void;
  /** Open every one of `paths`, for a reveal that walks down to a row. */
  expandPrefixes: (paths: readonly string[]) => void;
  /** What the objects document's search box holds. */
  searchPattern: string;
  searchRegex: boolean;
  setSearchPattern: (searchPattern: string) => void;
  setSearchRegex: (searchRegex: boolean) => void;
  /** Prefixes the user has shut in the search results tree, by path. */
  shutFindPrefixes: ReadonlySet<string>;
  toggleFindPrefix: (path: string) => void;
  /** The pending reveal, or null while none is owed. */
  reveal: ObjectsReveal | null;
  requestReveal: (path: string) => void;
  /** Drop the reveal with `token`. The tree it addressed has answered it. */
  settleReveal: (token: number) => void;
}

function toggled(set: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(set);
  if (next.has(value)) {
    next.delete(value);
  } else {
    next.add(value);
  }
  return next;
}

/**
 * What the objects browser is showing, held outside the document that draws it.
 *
 * The leaf a preview splits remounts the document under it. A tree held in the document
 * shuts on the click that opened the object. One store across the projects: every
 * objects tab browses one install.
 */
export const useObjectsBrowserStore = create<ObjectsBrowserStore>()((set) => ({
  selected: null,
  selectNode: (node) => {
    if (node.type !== "object" && node.type !== "prefix") return;
    const type = node.type;
    set((state) =>
      state.selected?.path === node.id && state.selected.type === type
        ? state
        : { selected: { path: node.id, type } },
    );
  },
  setView: (view) =>
    set((state) => {
      const selected = state.selected;
      if (view === state.display.view || selected === null) {
        return { display: { ...state.display, view } };
      }

      /* The search results tree takes no reveal, so a search keeps its hits in place. */
      if (view === "tree" && state.searchPattern.length > 0) {
        return { display: { ...state.display, view } };
      }

      if (view === "tree") {
        const token = state.revealToken + 1;
        return {
          display: { ...state.display, view },
          expandedPrefixes: new Set([
            ...state.expandedPrefixes,
            ...ancestorPrefixes(selected.path),
          ]),
          revealToken: token,
          reveal: { path: selected.path, token },
        };
      }

      if (selected.type === "prefix") {
        return {
          display: { ...state.display, view, location: selected.path },
          searchPattern: "",
          reveal: null,
        };
      }

      const token = state.revealToken + 1;
      return {
        display: { ...state.display, view, location: ancestorPrefixes(selected.path).at(-1) ?? "" },
        revealToken: token,
        reveal: { path: selected.path, token },
      };
    }),
  display: { view: "tree", thumbnails: true, location: "", tileSize: 128 },
  setDisplay: (display) => set((state) => ({ display: { ...state.display, ...display } })),
  revealToken: 0,
  expandedPrefixes: new Set(),
  togglePrefix: (path) =>
    set((state) => ({ expandedPrefixes: toggled(state.expandedPrefixes, path) })),
  expandPrefixes: (paths) =>
    set((state) => {
      if (paths.every((path) => state.expandedPrefixes.has(path))) return state;
      return { expandedPrefixes: new Set([...state.expandedPrefixes, ...paths]) };
    }),
  searchPattern: "",
  searchRegex: false,
  setSearchPattern: (searchPattern) => set({ searchPattern }),
  setSearchRegex: (searchRegex) => set({ searchRegex }),
  shutFindPrefixes: new Set(),
  toggleFindPrefix: (path) =>
    set((state) => ({ shutFindPrefixes: toggled(state.shutFindPrefixes, path) })),
  reveal: null,
  requestReveal: (path) =>
    set((state) => ({
      revealToken: state.revealToken + 1,
      reveal: { path, token: state.revealToken + 1 },
    })),
  settleReveal: (token) =>
    set((state) => (state.reveal?.token === token ? { reveal: null } : state)),
}));

export const useExpandedObjectPrefixes = () => useObjectsBrowserStore((s) => s.expandedPrefixes);
export const useObjectsDisplay = () => useObjectsBrowserStore((s) => s.display);
export const useSetObjectsDisplay = () => useObjectsBrowserStore((s) => s.setDisplay);
export const useSelectObjectNode = () => useObjectsBrowserStore((s) => s.selectNode);
export const useSelectedObjectPath = () => useObjectsBrowserStore((s) => s.selected?.path ?? null);
export const useSetObjectsView = () => useObjectsBrowserStore((s) => s.setView);
export const useToggleObjectPrefix = () => useObjectsBrowserStore((s) => s.togglePrefix);
export const useExpandObjectPrefixes = () => useObjectsBrowserStore((s) => s.expandPrefixes);
export const useObjectsSearchPattern = () => useObjectsBrowserStore((s) => s.searchPattern);
export const useSetObjectsSearchPattern = () => useObjectsBrowserStore((s) => s.setSearchPattern);
export const useObjectsSearchRegex = () => useObjectsBrowserStore((s) => s.searchRegex);
export const useSetObjectsSearchRegex = () => useObjectsBrowserStore((s) => s.setSearchRegex);
export const useShutFindPrefixes = () => useObjectsBrowserStore((s) => s.shutFindPrefixes);
export const useToggleFindPrefix = () => useObjectsBrowserStore((s) => s.toggleFindPrefix);
export const useObjectsReveal = () => useObjectsBrowserStore((s) => s.reveal);
export const useRequestObjectsReveal = () => useObjectsBrowserStore((s) => s.requestReveal);
export const useSettleObjectsReveal = () => useObjectsBrowserStore((s) => s.settleReveal);
