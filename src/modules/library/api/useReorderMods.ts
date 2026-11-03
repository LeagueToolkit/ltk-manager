import { useMutation, useQueryClient } from "@tanstack/react-query";

import { modOrderMutations } from "./modOrderMutations";
import { useClearedKeptSortToast } from "./useClearedKeptSortToast";

/**
 * Reorder mods in the active profile, optimistically.
 *
 * Takes a partial list of mod ids, such as the root mods alone, and appends the
 * rest from the cache so the backend receives the full set. A folder whose order
 * changed stops keeping its sort, which a toast reports with an Undo.
 */
export function useReorderMods() {
  const reportCleared = useClearedKeptSortToast();

  return useMutation({
    ...modOrderMutations.reorder(useQueryClient()),
    onSuccess: reportCleared,
  });
}
