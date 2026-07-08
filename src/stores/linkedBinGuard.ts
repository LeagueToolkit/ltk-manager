import { create } from "zustand";

interface LinkedBinDialogStore {
  /** Whether the reachable linked-bin warning dialog is open. */
  open: boolean;
  openDialog: () => void;
  close: () => void;
}

/**
 * Open-state for the reachable `LinkedBinWarningDialog`. The dialog reads the
 * offenders themselves from the `useLinkedBinOffenders` query; this store just
 * controls visibility so it can be opened from anywhere — a mod card's
 * `MissingDepsBadge` or the post-start warning toast.
 */
export const useLinkedBinGuardStore = create<LinkedBinDialogStore>((set) => ({
  open: false,
  openDialog: () => set({ open: true }),
  close: () => set({ open: false }),
}));
