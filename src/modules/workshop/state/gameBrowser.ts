import { create } from "zustand";

interface GameBrowserStore {
  /** Directories the user has opened in the game index tree, by index path. */
  expandedDirs: ReadonlySet<string>;
  toggleDir: (path: string) => void;
  /** What the game index document's search box holds. */
  searchPattern: string;
  searchRegex: boolean;
  setSearchPattern: (searchPattern: string) => void;
  setSearchRegex: (searchRegex: boolean) => void;
  /** Directories the user has shut in the search results tree, by index path. */
  shutFindDirs: ReadonlySet<string>;
  toggleFindDir: (path: string) => void;
  /** Directories shut in one archive's own tree, by archive name then path. */
  shutWadDirs: Record<string, ReadonlySet<string>>;
  toggleWadDir: (wadName: string, path: string) => void;
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
export const useGameBrowserStore = create<GameBrowserStore>((set) => ({
  expandedDirs: new Set(),
  toggleDir: (path) => set((state) => ({ expandedDirs: toggled(state.expandedDirs, path) })),
  searchPattern: "",
  searchRegex: false,
  setSearchPattern: (searchPattern) => set({ searchPattern }),
  setSearchRegex: (searchRegex) => set({ searchRegex }),
  shutFindDirs: new Set(),
  toggleFindDir: (path) => set((state) => ({ shutFindDirs: toggled(state.shutFindDirs, path) })),
  shutWadDirs: {},
  toggleWadDir: (wadName, path) =>
    set((state) => ({
      shutWadDirs: {
        ...state.shutWadDirs,
        [wadName]: toggled(state.shutWadDirs[wadName] ?? NO_SHUT_DIRS, path),
      },
    })),
  wadFilter: "",
  setWadFilter: (wadFilter) => set({ wadFilter }),
  scrollTops: {},
  setScrollTop: (key, top) => set((state) => ({ scrollTops: { ...state.scrollTops, [key]: top } })),
}));

export const useExpandedGameDirs = () => useGameBrowserStore((s) => s.expandedDirs);
export const useToggleGameDir = () => useGameBrowserStore((s) => s.toggleDir);
export const useGameSearchPattern = () => useGameBrowserStore((s) => s.searchPattern);
export const useSetGameSearchPattern = () => useGameBrowserStore((s) => s.setSearchPattern);
export const useGameSearchRegex = () => useGameBrowserStore((s) => s.searchRegex);
export const useSetGameSearchRegex = () => useGameBrowserStore((s) => s.setSearchRegex);
export const useShutFindDirs = () => useGameBrowserStore((s) => s.shutFindDirs);
export const useToggleFindDir = () => useGameBrowserStore((s) => s.toggleFindDir);
export const useShutWadDirs = (wadName: string) =>
  useGameBrowserStore((s) => s.shutWadDirs[wadName] ?? NO_SHUT_DIRS);
export const useToggleWadDir = () => useGameBrowserStore((s) => s.toggleWadDir);
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
