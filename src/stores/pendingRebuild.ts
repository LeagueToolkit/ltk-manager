import { create } from "zustand";

interface PendingRebuildStore {
  /** A forced overlay rebuild is owed to the next patcher start. */
  queued: boolean;
  queue: () => void;
  clear: () => void;
}

/**
 * The rebuild a verdict asked for while the patcher was running, held until
 * the next start honours it once. Per "The verdict line" in
 * docs/ux/LEAGUE_DIAGNOSTICS.md.
 */
export const usePendingRebuildStore = create<PendingRebuildStore>()((set) => ({
  queued: false,
  queue: () => set({ queued: true }),
  clear: () => set({ queued: false }),
}));
