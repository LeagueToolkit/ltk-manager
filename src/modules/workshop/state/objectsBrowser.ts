import { create } from "zustand";

/** A row the objects browser is asked to expand to, focus and scroll to. */
export interface ObjectsReveal {
  /** The object's path, which is its row's key. */
  readonly path: string;
  /** Bumped per request. Two reveals of one row both land. */
  readonly token: number;
}

interface ObjectsBrowserStore {
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
export const useObjectsBrowserStore = create<ObjectsBrowserStore>((set) => ({
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
    set((state) => ({ reveal: { path, token: (state.reveal?.token ?? 0) + 1 } })),
  settleReveal: (token) =>
    set((state) => (state.reveal?.token === token ? { reveal: null } : state)),
}));

export const useExpandedObjectPrefixes = () => useObjectsBrowserStore((s) => s.expandedPrefixes);
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
