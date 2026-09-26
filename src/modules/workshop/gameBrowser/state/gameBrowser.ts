import { create } from "zustand";

/** A row the game index tree is asked to open down to, focus and scroll to. */
export interface GameReveal {
  /** The file row's id, which is what the tree matches on. */
  readonly id: string;
  /** Bumped per request. Two reveals of one row both land. */
  readonly token: number;
}

interface GameBrowserStore {
  /** Directories the user has opened in the game index tree, by index path. */
  expandedDirs: ReadonlySet<string>;
  toggleDir: (path: string) => void;
  /** Open every one of `paths`, for a reveal that walks down to a row. */
  expandDirs: (paths: readonly string[]) => void;
  /** Collapse every directory of the game index tree. */
  collapseAllDirs: () => void;
  /** Collapse `path` and every directory under it in the game index tree. */
  collapseDirTree: (path: string) => void;
  /** The pending reveal, or null while none is owed. */
  reveal: GameReveal | null;
  requestReveal: (id: string) => void;
  /** Drop the reveal with `token`. The tree it addressed has answered it. */
  settleReveal: (token: number) => void;
  /** What the game index document's search box holds. */
  searchPattern: string;
  searchRegex: boolean;
  setSearchPattern: (searchPattern: string) => void;
  setSearchRegex: (searchRegex: boolean) => void;
  /** Directories the user has shut in the search results tree, by index path. */
  shutFindDirs: ReadonlySet<string>;
  toggleFindDir: (path: string) => void;
  /** Collapse exactly `paths` in the search results tree. */
  setCollapsedFindDirs: (paths: ReadonlySet<string>) => void;
  /** Directories shut in one archive's own tree, by archive name then path. */
  shutWadDirs: Record<string, ReadonlySet<string>>;
  toggleWadDir: (wadName: string, path: string) => void;
  /** Collapse exactly `paths` in one archive's tree. */
  setCollapsedWadDirs: (wadName: string, paths: ReadonlySet<string>) => void;
  /** What the WAD list's box holds. */
  wadFilter: string;
  setWadFilter: (wadFilter: string) => void;
  /** Where a list was left scrolled, in px, by the key the list names itself. */
  scrollTops: Record<string, number>;
  setScrollTop: (key: string, top: number) => void;
}

/** The shut set of an archive nobody has shut a directory in. */
const NO_SHUT_DIRS: ReadonlySet<string> = new Set();

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
 * What the game browser is showing, held outside the documents that draw it.
 *
 * The first preview a tree opens splits a group off beside it, and a leaf that
 * gains a split around it remounts everything under it. A document holding its
 * own tree state would therefore lose it on the very double click that opened
 * the file - the tree would shut, the box would empty, the scroll would jump.
 * One store across the projects, since every game tab browses one install.
 */
export const useGameBrowserStore = create<GameBrowserStore>()((set) => ({
  expandedDirs: new Set(),
  toggleDir: (path) => set((state) => ({ expandedDirs: toggled(state.expandedDirs, path) })),
  expandDirs: (paths) =>
    set((state) => {
      if (paths.every((path) => state.expandedDirs.has(path))) return state;
      return { expandedDirs: new Set([...state.expandedDirs, ...paths]) };
    }),
  collapseAllDirs: () => set({ expandedDirs: new Set() }),
  collapseDirTree: (path) =>
    set((state) => {
      const under = `${path}/`;
      const kept = [...state.expandedDirs].filter(
        (open) => open !== path && !open.startsWith(under),
      );
      if (kept.length === state.expandedDirs.size) return state;

      return { expandedDirs: new Set(kept) };
    }),
  reveal: null,
  requestReveal: (id) =>
    set((state) => ({ reveal: { id, token: (state.reveal?.token ?? 0) + 1 } })),
  settleReveal: (token) =>
    set((state) => (state.reveal?.token === token ? { reveal: null } : state)),
  searchPattern: "",
  searchRegex: false,
  setSearchPattern: (searchPattern) => set({ searchPattern }),
  setSearchRegex: (searchRegex) => set({ searchRegex }),
  shutFindDirs: new Set(),
  toggleFindDir: (path) => set((state) => ({ shutFindDirs: toggled(state.shutFindDirs, path) })),
  setCollapsedFindDirs: (paths) => set({ shutFindDirs: new Set(paths) }),
  shutWadDirs: {},
  toggleWadDir: (wadName, path) =>
    set((state) => ({
      shutWadDirs: {
        ...state.shutWadDirs,
        [wadName]: toggled(state.shutWadDirs[wadName] ?? NO_SHUT_DIRS, path),
      },
    })),
  setCollapsedWadDirs: (wadName, paths) =>
    set((state) => ({ shutWadDirs: { ...state.shutWadDirs, [wadName]: new Set(paths) } })),
  wadFilter: "",
  setWadFilter: (wadFilter) => set({ wadFilter }),
  scrollTops: {},
  setScrollTop: (key, top) => set((state) => ({ scrollTops: { ...state.scrollTops, [key]: top } })),
}));

export const useExpandedGameDirs = () => useGameBrowserStore((s) => s.expandedDirs);
export const useToggleGameDir = () => useGameBrowserStore((s) => s.toggleDir);
export const useExpandGameDirs = () => useGameBrowserStore((s) => s.expandDirs);
export const useCollapseAllGameDirs = () => useGameBrowserStore((s) => s.collapseAllDirs);
export const useCollapseGameDirTree = () => useGameBrowserStore((s) => s.collapseDirTree);
export const useGameReveal = () => useGameBrowserStore((s) => s.reveal);
export const useRequestGameReveal = () => useGameBrowserStore((s) => s.requestReveal);
export const useSettleGameReveal = () => useGameBrowserStore((s) => s.settleReveal);
export const useGameSearchPattern = () => useGameBrowserStore((s) => s.searchPattern);
export const useSetGameSearchPattern = () => useGameBrowserStore((s) => s.setSearchPattern);
export const useGameSearchRegex = () => useGameBrowserStore((s) => s.searchRegex);
export const useSetGameSearchRegex = () => useGameBrowserStore((s) => s.setSearchRegex);
export const useShutFindDirs = () => useGameBrowserStore((s) => s.shutFindDirs);
export const useToggleFindDir = () => useGameBrowserStore((s) => s.toggleFindDir);
export const useSetCollapsedFindDirs = () => useGameBrowserStore((s) => s.setCollapsedFindDirs);
export const useShutWadDirs = (wadName: string) =>
  useGameBrowserStore((s) => s.shutWadDirs[wadName] ?? NO_SHUT_DIRS);
export const useToggleWadDir = () => useGameBrowserStore((s) => s.toggleWadDir);
export const useSetCollapsedWadDirs = () => useGameBrowserStore((s) => s.setCollapsedWadDirs);
export const useWadFilter = () => useGameBrowserStore((s) => s.wadFilter);
export const useSetWadFilter = () => useGameBrowserStore((s) => s.setWadFilter);

/**
 * Read at mount and written back at unmount, so a scroll costs nothing while it
 * happens. Outside React, because a list that re-rendered on its own scroll
 * would spend the scroll twice.
 */
export function keptScrollTop(key: string): number {
  return useGameBrowserStore.getState().scrollTops[key] ?? 0;
}

export function keepScrollTop(key: string, top: number): void {
  useGameBrowserStore.getState().setScrollTop(key, top);
}
