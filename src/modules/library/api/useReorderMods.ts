import { useMutation, useQueryClient } from "@tanstack/react-query";

import { modOrderMutations } from "./modOrderMutations";

/**
 * Reorder mods in the active profile, optimistically.
 *
 * Takes a partial list of mod ids, such as the root mods alone, and appends the
 * rest from the cache so the backend receives the full set.
 */
export function useReorderMods() {
  return useMutation(modOrderMutations.reorder(useQueryClient()));
}
