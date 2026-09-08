import { useShallow } from "zustand/react/shallow";

import { type HistoryEntry, useWorkshopEditorStore } from "./workshopEditor";

/**
 * The navigation history, which spans both workshop surfaces.
 *
 * Every hook here reads the store root rather than a project, unlike the ones
 * in `useProjectEditor`, because the stack is the shell's: the arrows walk out
 * of a project the same way they walk between its tabs, so they render over the
 * grid as well as inside an editor.
 */

/** What each arrow would reach, or null where it has nothing behind it. */
export function useHistoryReach(): {
  back: HistoryEntry | null;
  forward: HistoryEntry | null;
} {
  return useWorkshopEditorStore(
    useShallow((s) => ({
      back: s.history[s.historyIndex - 1] ?? null,
      forward: s.history[s.historyIndex + 1] ?? null,
    })),
  );
}

/**
 * Moves the stack, and reports the stop it reached.
 *
 * The caller routes to it. A stop in another project is a route change, and a
 * store cannot make one.
 */
export function useNavigateHistory(): (delta: number) => HistoryEntry | null {
  return useWorkshopEditorStore((s) => s.navigateHistory);
}

/** Records the grid as a stop, which is what a back out of a project lands on. */
export function useRecordListVisit(): () => void {
  return useWorkshopEditorStore((s) => s.recordListVisit);
}
