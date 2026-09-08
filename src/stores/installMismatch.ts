import { create } from "zustand";

/**
 * The install the manager is set up for against the one a game runs from, as
 * the client check or a wrong-install verdict found it.
 *
 * The patchlines are `null` when the news came from a game log rather than
 * from the Riot Client, which names the paths and nothing else.
 */
export interface DetectedInstallMismatch {
  configuredPath: string;
  configuredPatchline: string | null;
  sessionPath: string;
  sessionPatchline: string | null;
}

interface InstallMismatchStore {
  /** The mismatch the dialog is up for, or `null` while it has nothing to say. */
  mismatch: DetectedInstallMismatch | null;
  /** `Keep` was pressed this patcher session. The dialog stays down until the next start. */
  kept: boolean;
  /** Puts the dialog up, unless it was kept down for this patcher session. */
  raise: (mismatch: DetectedInstallMismatch) => void;
  keep: () => void;
  clear: () => void;
  /** A patcher session started. A kept dialog may return. */
  reset: () => void;
}

/**
 * The install mismatch dialog's state, per "The install mismatch dialog" in
 * docs/ux/LEAGUE_DIAGNOSTICS.md. The client check and the wrong-install
 * verdict both raise it here, and the dialog queue decides when it shows.
 */
export const useInstallMismatchStore = create<InstallMismatchStore>()((set) => ({
  mismatch: null,
  kept: false,
  raise: (mismatch) => set((state) => (state.kept ? state : { mismatch })),
  keep: () => set({ mismatch: null, kept: true }),
  clear: () => set({ mismatch: null }),
  reset: () => set({ kept: false }),
}));
