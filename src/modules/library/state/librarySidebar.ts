import { create } from "zustand";
import { persist } from "zustand/middleware";

import { localJsonStorage } from "@/stores/storage";

/** Which of the panel's two documents is showing. */
export type DocumentsTab = "readme" | "licenses";

interface LibrarySidebarStore {
  /** Whether the panel is beside the grid. */
  open: boolean;
  tab: DocumentsTab;
  /**
   * The mod the Readme tab is holding.
   *
   * An id rather than a name, so renaming a mod does not orphan the panel.
   */
  modId: string | null;
  /**
   * The grid's and the panel's shares of the row, keyed by panel id.
   *
   * `null` until the seam has been dragged, which is what tells a first open
   * from a width the reader chose.
   */
  split: Record<string, number> | null;
  /** Open the panel on the library-wide tab, or close it. */
  toggle: () => void;
  close: () => void;
  showTab: (tab: DocumentsTab) => void;
  /** Open the panel on `modId`'s readme. */
  showReadme: (modId: string) => void;
  setSplit: (split: Record<string, number>) => void;
}

/**
 * What the Library's documents panel is showing, and how wide it was left.
 *
 * The width outlives a restart and nothing else does. A library that booted
 * into a narrower grid would be charging a reader for a panel they had
 * forgotten, and a mod held across sessions can be uninstalled between them.
 */
export const useLibrarySidebarStore = create<LibrarySidebarStore>()(
  persist(
    (set, get) => ({
      open: false,
      /* The toolbar's own tab: it needs no mod and is full on first open. */
      tab: "licenses",
      modId: null,
      split: null,

      toggle: () => set({ open: !get().open, tab: "licenses" }),
      close: () => set({ open: false }),
      showTab: (tab) => set({ tab }),
      showReadme: (modId) => set({ open: true, tab: "readme", modId }),
      setSplit: (split) => set({ split }),
    }),
    {
      name: "ltk-library-sidebar",
      version: 1,
      storage: localJsonStorage,
      partialize: (state) => ({ split: state.split }),
    },
  ),
);
