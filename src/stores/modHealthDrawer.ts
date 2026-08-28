import { create } from "zustand";

/** Wide enough for a mod name and its one line of detail, and no wider. */
const DEFAULT_WIDTH = 380;

interface ModHealthDrawerStore {
  /** Whether the mod health drawer is showing. */
  open: boolean;
  /** How wide the reader last dragged it, which outlives a close. */
  width: number;
  /** Whether this run has already opened the drawer without being asked. */
  announced: boolean;
  openDrawer: () => void;
  setWidth: (width: number) => void;
  /**
   * Open the drawer unprompted, at most once for the life of the app.
   *
   * The cap is here rather than at the caller because the caller is an effect
   * over the verdicts, which move every time a repair lands.
   */
  announce: () => void;
  close: () => void;
}

/**
 * Open-state for the mod health drawer, which its trigger cannot reach.
 *
 * The status bar hosts the item that opens it and the library hosts the drawer
 * itself, so the app shell sits between them. The drawer reads what it holds
 * from the verdict queries - this is only what those two share, plus the width,
 * which has nowhere else to survive a close now that the panel unmounts.
 */
export const useModHealthDrawerStore = create<ModHealthDrawerStore>((set) => ({
  open: false,
  width: DEFAULT_WIDTH,
  announced: false,
  openDrawer: () => set({ open: true }),
  setWidth: (width) => set({ width }),
  announce: () => set((state) => (state.announced ? state : { open: true, announced: true })),
  close: () => set({ open: false }),
}));
