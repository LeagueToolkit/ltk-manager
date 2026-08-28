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
  /** Whether something asked for a repair the drawer has not started yet. */
  repairRequested: boolean;
  /**
   * Whether a drawer is mounted for the trigger to open.
   *
   * Mod health is a library surface, and the cell that opens it sits in the
   * app-wide status bar. Reported by the host rather than matched on the route,
   * so a cell can never offer a drawer no page is there to mount.
   */
  hosted: boolean;
  setHosted: (hosted: boolean) => void;
  openDrawer: () => void;
  /**
   * Open the drawer and have it repair what the next game would carry.
   *
   * The launch guard's way in. The run itself is the drawer's, because the hook
   * behind it carries the progress subscription and is mounted exactly once, so
   * what crosses is the request rather than the press.
   */
  requestRepair: () => void;
  /** Take the pending request, so the drawer starts it once. */
  takeRepairRequest: () => void;
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
  repairRequested: false,
  hosted: false,
  setHosted: (hosted) => set({ hosted }),
  openDrawer: () => set({ open: true }),
  requestRepair: () => set({ open: true, repairRequested: true }),
  takeRepairRequest: () => set({ repairRequested: false }),
  setWidth: (width) => set({ width }),
  announce: () => set((state) => (state.announced ? state : { open: true, announced: true })),
  close: () => set({ open: false, repairRequested: false }),
}));
