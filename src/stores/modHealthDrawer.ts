import { create } from "zustand";
import { persist } from "zustand/middleware";

import { keepUnversioned } from "./storage";

/** Wide enough for a mod name and its one line of detail, and no wider. */
const DEFAULT_WIDTH = 380;

interface ModHealthDrawerStore {
  /** Whether the mod health drawer is showing. */
  open: boolean;
  /** How wide the reader last dragged it, which outlives a close. */
  width: number;
  /** Whether this run has already opened the drawer without being asked. */
  announced: boolean;
  /** The `announcementKey` the reader was last told about, `null` before any. */
  announcedFor: string | null;
  /** Whether something asked for a repair the drawer has not started yet. */
  repairRequested: boolean;
  /**
   * The mod the panel was opened about, which it lists and scrolls to.
   *
   * A press on one mod is answered about that mod, so the row is there even
   * where every library-wide surface stays quiet about it.
   */
  focusModId: string | null;
  /**
   * Whether the panel also lists the mods whose findings are all informative.
   *
   * Off until a reader asks, because nothing under it is a fault and the panel
   * is answering what is wrong with the library. It outlives a close, so a
   * reader who wants the fuller list is not asked for the press every time.
   */
  showInformational: boolean;
  toggleInformational: () => void;
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
   * Open the drawer on one mod, wherever the rest of the library stands.
   *
   * Unfolds the informative rows with it, because the mod a press asks about is
   * one of them and a fold left shut answers with a line rather than a row.
   */
  showMod: (modId: string) => void;
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
   * Claim the unprompted announcement `key` is owed, if it is owed one.
   *
   * The run spends its one announcement on the first call whatever the answer
   * is, because the caller is an effect over verdicts that move as repairs land.
   */
  takeAnnouncement: (key: string) => boolean;
  /**
   * Forget what the reader was told, so the next findings announce again.
   *
   * A press asking what is wrong with the library reopens the question the
   * announcement answers, and the answer is the drawer either way.
   */
  forgetAnnouncement: () => void;
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
export const useModHealthDrawerStore = create<ModHealthDrawerStore>()(
  persist(
    (set, get) => ({
      open: false,
      width: DEFAULT_WIDTH,
      announced: false,
      announcedFor: null,
      repairRequested: false,
      focusModId: null,
      showInformational: false,
      hosted: false,
      setHosted: (hosted) => set({ hosted }),
      toggleInformational: () => set({ showInformational: !get().showInformational }),
      openDrawer: () => set({ open: true, focusModId: null }),
      showMod: (modId) => set({ open: true, focusModId: modId, showInformational: true }),
      requestRepair: () => set({ open: true, repairRequested: true, focusModId: null }),
      takeRepairRequest: () => set({ repairRequested: false }),
      setWidth: (width) => set({ width }),
      takeAnnouncement: (key) => {
        if (get().announced) return false;
        const owed = get().announcedFor !== key;
        set({ announced: true, announcedFor: key });
        return owed;
      },
      forgetAnnouncement: () => set({ announced: false, announcedFor: null }),
      close: () => set({ open: false, repairRequested: false, focusModId: null }),
    }),
    {
      name: "mod-health-drawer",
      version: 1,
      migrate: keepUnversioned<ModHealthDrawerStore>,
      /* The panel's own state belongs to the session that shaped it. */
      partialize: (state) => ({
        announcedFor: state.announcedFor,
        showInformational: state.showInformational,
      }),
    },
  ),
);
