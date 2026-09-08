import type { Update } from "@tauri-apps/plugin-updater";
import { create } from "zustand";

const SKIPPED_VERSION_KEY = "ltk-update-skipped-version";

/** Who opened the dialog: the check that found the update, or a press. */
export type UpdateDialogOpener = "check" | "press";

interface UpdaterStore {
  checking: boolean;
  updating: boolean;
  update: Update | null;
  error: string | null;
  progress: number;
  dialogOpen: boolean;
  /** `null` while the dialog is closed. */
  dialogOpener: UpdateDialogOpener | null;
  skippedVersion: string | null;

  startCheck: () => void;
  /** Take what a check found, raising the dialog unless the version is skipped. */
  reportCheck: (update: Update | null) => void;
  failCheck: (message: string) => void;
  startInstall: () => void;
  reportProgress: (percent: number) => void;
  failInstall: (message: string) => void;
  dismissError: () => void;
  setDialogOpen: (open: boolean) => void;
  /** Close a dialog the check opened, for a page already showing what it would. */
  dropCheckOpening: () => void;
  isVersionSkipped: () => boolean;
  setSkipVersion: (skip: boolean) => void;
}

/* Read through `globalThis`, because the store is built at import time and an
   import outside a DOM would otherwise throw before the app ever runs. */
const skippedAtStart = globalThis.localStorage?.getItem(SKIPPED_VERSION_KEY) ?? null;

/**
 * What the app knows about an available update, as one state machine.
 *
 * The download itself lives in `modules/updater/api`, which drives this store
 * through the transitions above.
 */
const store = create<UpdaterStore>()((set, get) => ({
  checking: false,
  updating: false,
  update: null,
  error: null,
  progress: 0,
  dialogOpen: false,
  dialogOpener: null,
  skippedVersion: skippedAtStart,

  startCheck: () => set({ checking: true, error: null }),

  reportCheck: (update) => {
    const shouldOpen = update !== null && get().skippedVersion !== update.version;
    set({
      checking: false,
      update,
      dialogOpen: shouldOpen,
      dialogOpener: shouldOpen ? "check" : null,
    });
  },

  failCheck: (message) => set({ checking: false, error: message }),

  startInstall: () => set({ updating: true, error: null, progress: 0 }),

  reportProgress: (percent) => set({ progress: percent }),

  failInstall: (message) =>
    set({ updating: false, error: message, dialogOpen: true, dialogOpener: "press" }),

  dismissError: () => set({ error: null }),

  setDialogOpen: (open) => set({ dialogOpen: open, dialogOpener: open ? "press" : null }),

  dropCheckOpening: () =>
    set((state) =>
      state.dialogOpener === "check" ? { dialogOpen: false, dialogOpener: null } : state,
    ),

  isVersionSkipped: () => {
    const { update, skippedVersion } = get();
    if (!update) return false;
    return skippedVersion === update.version;
  },

  setSkipVersion: (skip) => {
    const { update } = get();
    if (!update) return;

    if (skip) {
      localStorage.setItem(SKIPPED_VERSION_KEY, update.version);
      set({ skippedVersion: update.version });
    } else {
      localStorage.removeItem(SKIPPED_VERSION_KEY);
      set({ skippedVersion: null });
    }
  },
}));

export const useUpdaterStore = store;

export const useUpdaterChecking = () => store((s) => s.checking);
export const useUpdaterUpdating = () => store((s) => s.updating);
export const useUpdaterUpdate = () => store((s) => s.update);
export const useUpdaterError = () => store((s) => s.error);
export const useUpdaterProgress = () => store((s) => s.progress);
export const useUpdaterDialogOpen = () => store((s) => s.dialogOpen);
export const useUpdaterDismissError = () => store((s) => s.dismissError);
export const useUpdaterSetDialogOpen = () => store((s) => s.setDialogOpen);
export const useUpdaterDialogOpener = () => store((s) => s.dialogOpener);
export const useUpdaterDropCheckOpening = () => store((s) => s.dropCheckOpening);
export const useUpdaterSkippedVersion = () => store((s) => s.skippedVersion);
export const useUpdaterIsVersionSkipped = () => store((s) => s.isVersionSkipped);
export const useUpdaterSetSkipVersion = () => store((s) => s.setSkipVersion);
