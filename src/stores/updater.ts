import { create } from "zustand";

import type { PendingUpdate } from "@/lib/tauri";

const SKIPPED_VERSION_KEY = "ltk-update-skipped-version";

/** Who opened the dialog: the check that found the update, or a press. */
export type UpdateDialogOpener = "check" | "press";

interface UpdaterStore {
  checking: boolean;
  /** When the last check answered, in epoch milliseconds. `null` before the first. */
  checkedAt: number | null;
  checkError: string | null;
  update: PendingUpdate | null;
  /** Whether the first check of the run found the update, the one launch waits for. */
  foundAtLaunch: boolean;
  downloading: boolean;
  /** Whether the installer is on disk, so an install is a restart. */
  downloaded: boolean;
  progress: number;
  updating: boolean;
  /** Why the last install failed. */
  error: string | null;
  dialogOpen: boolean;
  /** `null` while the dialog is closed. */
  dialogOpener: UpdateDialogOpener | null;
  skippedVersion: string | null;

  startCheck: () => void;
  /** Take what a check found, raising the dialog for a release not seen or skipped yet. */
  reportCheck: (update: PendingUpdate | null) => void;
  failCheck: (message: string) => void;
  startDownload: () => void;
  reportProgress: (percent: number) => void;
  finishDownload: () => void;
  failDownload: () => void;
  startInstall: () => void;
  failInstall: (message: string) => void;
  dismissError: () => void;
  setDialogOpen: (open: boolean) => void;
  /** Close a dialog the check opened, for a page already showing what it would. */
  dropCheckOpening: () => void;
  /** Forget a downloaded installer, so the next install downloads again. */
  dropDownload: () => void;
  isVersionSkipped: () => boolean;
  setSkipVersion: (skip: boolean) => void;
}

/* Read through `globalThis`, because the store is built at import time and an
   import outside a DOM would otherwise throw before the app ever runs. */
const skippedAtStart = globalThis.localStorage?.getItem(SKIPPED_VERSION_KEY) ?? null;

/**
 * What the app knows about an available update, as one state machine.
 *
 * The check, the download and the install live in `modules/updater/api`, which
 * drive this store through the transitions above.
 */
const store = create<UpdaterStore>()((set, get) => ({
  checking: false,
  checkedAt: null,
  checkError: null,
  update: null,
  foundAtLaunch: false,
  downloading: false,
  downloaded: false,
  progress: 0,
  updating: false,
  error: null,
  dialogOpen: false,
  dialogOpener: null,
  skippedVersion: skippedAtStart,

  startCheck: () => set({ checking: true, checkError: null }),

  reportCheck: (update) => {
    const state = get();
    const answered = {
      checking: false,
      checkedAt: Date.now(),
      foundAtLaunch: state.checkedAt === null ? update !== null : state.foundAtLaunch,
    };
    if (update !== null && update.version === state.update?.version) {
      set(answered);
      return;
    }
    const raise = update !== null && update.version !== state.skippedVersion;
    set({
      ...answered,
      update,
      downloaded: false,
      progress: 0,
      dialogOpen: raise,
      dialogOpener: raise ? "check" : null,
    });
  },

  failCheck: (message) => set({ checking: false, checkError: message }),

  startDownload: () => set({ downloading: true }),

  reportProgress: (percent) => set({ progress: percent }),

  finishDownload: () => set({ downloading: false, downloaded: true, progress: 100 }),

  failDownload: () => set({ downloading: false, downloaded: false, progress: 0 }),

  startInstall: () => set({ updating: true, error: null }),

  failInstall: (message) =>
    set({ updating: false, error: message, dialogOpen: true, dialogOpener: "press" }),

  dismissError: () => set({ error: null }),

  setDialogOpen: (open) => set({ dialogOpen: open, dialogOpener: open ? "press" : null }),

  dropCheckOpening: () =>
    set((state) =>
      state.dialogOpener === "check" ? { dialogOpen: false, dialogOpener: null } : state,
    ),

  dropDownload: () => set({ downloaded: false, progress: 0 }),

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
      set({ skippedVersion: update.version, downloaded: false, progress: 0 });
    } else {
      localStorage.removeItem(SKIPPED_VERSION_KEY);
      set({ skippedVersion: null });
    }
  },
}));

export const useUpdaterStore = store;

export const useUpdaterChecking = () => store((s) => s.checking);
export const useUpdaterCheckedAt = () => store((s) => s.checkedAt);
export const useUpdaterCheckError = () => store((s) => s.checkError);
export const useUpdaterFoundAtLaunch = () => store((s) => s.foundAtLaunch);
export const useUpdaterUpdating = () => store((s) => s.updating);
export const useUpdaterDownloaded = () => store((s) => s.downloaded);
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
