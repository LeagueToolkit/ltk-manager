import { create } from "zustand";
import { persist } from "zustand/middleware";

import { keepUnversioned, localJsonStorage } from "@/stores/storage";

/** Which of the panel's documents is showing. */
export type DocumentsTab = "details" | "readme" | "licenses";

/** Everything the panel is showing, as one value a guard can hold back. */
interface SidebarView {
  open: boolean;
  tab: DocumentsTab;
  /**
   * The mod the per-mod tabs are holding.
   *
   * An id rather than a name, so renaming a mod does not orphan the panel.
   */
  modId: string | null;
}

interface LibrarySidebarStore extends SidebarView {
  /**
   * The view asked for while the Details form held edits nobody had saved.
   *
   * The panel is not modal, so a reader can press another card, another tab or
   * the close button mid-edit. Each of those unmounts the form, and a
   * half-typed name is not a name.
   */
  pending: SidebarView | null;
  /** Whether the Details form holds edits nobody has saved. */
  dirty: boolean;
  /** How wide the drawer opens, in pixels. */
  width: number;
  /** Show the panel, or hide it, on whichever tab it was left. */
  toggle: () => void;
  close: () => void;
  showTab: (tab: DocumentsTab) => void;
  /** Open the panel on what `modId` is. */
  showDetails: (modId: string) => void;
  /** Open the panel on `modId`'s readme. */
  showReadme: (modId: string) => void;
  setDirty: (dirty: boolean) => void;
  /** Take the view the guard held back, or drop it. */
  resolvePending: (take: boolean) => void;
  setWidth: (width: number) => void;
}

/** Whether `next` leaves the Details form the reader is typing into. */
function leavesTheForm(current: SidebarView, next: SidebarView): boolean {
  const stays = next.open && next.tab === "details" && next.modId === current.modId;
  return !stays;
}

/** The width a drawer nobody has dragged opens at. */
export const DEFAULT_DRAWER_WIDTH = 360;

/** The narrowest a drag may leave the drawer. */
const MIN_DRAWER_WIDTH = 280;

/** What the drawer always leaves of the library underneath it. */
const GRID_KEPT = 320;

/**
 * What a drag may leave the drawer, given the room `viewport` has.
 *
 * The floor wins where the two disagree, because a window too narrow to hold
 * both still has to hold the drawer a reader just opened.
 */
export function clampDrawerWidth(next: number, viewport: number): number {
  const ceiling = Math.max(MIN_DRAWER_WIDTH, viewport - GRID_KEPT);
  return Math.round(Math.max(MIN_DRAWER_WIDTH, Math.min(next, ceiling)));
}

/**
 * What the Library's documents drawer is showing, and how wide it was left.
 *
 * The width outlives a restart and nothing else does. A drawer that reopened
 * itself would be covering cards a reader had forgotten asking about, and a mod
 * held across sessions can be uninstalled between them.
 */
export const useLibrarySidebarStore = create<LibrarySidebarStore>()(
  persist(
    (set, get) => {
      const view = (): SidebarView => {
        const { open, tab, modId } = get();
        return { open, tab, modId };
      };

      /* Every door out of the form, whichever control the reader pressed. */
      const requestView = (next: SidebarView) => {
        const current = get();
        if (current.dirty && leavesTheForm(current, next)) {
          set({ pending: next });
          return;
        }
        set({ ...next, pending: null });
      };

      return {
        open: false,
        tab: "details",
        modId: null,
        pending: null,
        dirty: false,
        width: DEFAULT_DRAWER_WIDTH,

        toggle: () => requestView({ ...view(), open: !get().open }),
        close: () => requestView({ ...view(), open: false }),
        showTab: (tab) => requestView({ ...view(), open: true, tab }),
        showDetails: (modId) => requestView({ open: true, tab: "details", modId }),
        showReadme: (modId) => requestView({ open: true, tab: "readme", modId }),
        setDirty: (dirty) => set({ dirty }),
        resolvePending: (take) => {
          const { pending } = get();
          if (!pending) return;
          if (!take) {
            set({ pending: null });
            return;
          }
          set({ ...pending, pending: null, dirty: false });
        },
        setWidth: (width) => set({ width }),
      };
    },
    {
      name: "ltk-library-sidebar",
      version: 2,
      /* v1 kept the two shares of a seam the drawer does not have. */
      migrate: (persisted, version) =>
        version < 2 ? { width: DEFAULT_DRAWER_WIDTH } : keepUnversioned(persisted),
      storage: localJsonStorage,
      partialize: (state) => ({ width: state.width }),
    },
  ),
);
