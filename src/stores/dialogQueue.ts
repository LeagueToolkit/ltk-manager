import { useEffect } from "react";
import { create } from "zustand";

/**
 * The dialogs that raise themselves, in the order the screen is granted.
 *
 * The order is the decision, and its reasons are ADR-0022.
 */
export const DIALOG_ORDER = [
  "protocol-install",
  "wad-scan-failed",
  "install-mismatch",
  "linked-bin-warning",
  "library-migration",
  "mod-health",
  "diagnostics-notice",
  "update",
] as const;

/** One dialog that asks for the screen without the reader having asked for it. */
export type QueuedDialog = (typeof DIALOG_ORDER)[number];

interface DialogQueueStore {
  /** The dialog holding the screen, or `null` while none asks for it. */
  current: QueuedDialog | null;
  /** Every dialog asking, `current` among them. */
  claims: QueuedDialog[];
  request: (dialog: QueuedDialog) => void;
  release: (dialog: QueuedDialog) => void;
}

/**
 * Which self-raising dialog holds the screen, so two never stack.
 *
 * Each one keeps its own state and its own trigger. All this arbitrates is who
 * is showing, and a dialog that closes hands the screen to the next claim.
 */
export const useDialogQueueStore = create<DialogQueueStore>()((set) => ({
  current: null,
  claims: [],
  request: (dialog) =>
    set((state) => (state.claims.includes(dialog) ? state : granted([...state.claims, dialog]))),
  release: (dialog) => set((state) => granted(state.claims.filter((claim) => claim !== dialog))),
}));

/** The claims, and which of them the order grants the screen to. */
function granted(claims: QueuedDialog[]): Pick<DialogQueueStore, "claims" | "current"> {
  return { claims, current: DIALOG_ORDER.find((dialog) => claims.includes(dialog)) ?? null };
}

/**
 * Claim the screen for `dialog` while `wanted`, and answer whether it shows.
 *
 * Call it above any early return, so a dialog that draws nothing yet still
 * holds its place. Dropping `wanted` releases the claim, which is what lets a
 * dialog closing itself raise the next one.
 */
export function useQueuedDialog(dialog: QueuedDialog, wanted: boolean): boolean {
  const request = useDialogQueueStore((state) => state.request);
  const release = useDialogQueueStore((state) => state.release);
  const current = useDialogQueueStore((state) => state.current);

  useEffect(() => {
    if (!wanted) return;
    request(dialog);
    return () => release(dialog);
  }, [dialog, wanted, request, release]);

  /* `wanted` as well as the grant: the render that drops it comes before the
     cleanup that releases the claim. */
  return wanted && current === dialog;
}
