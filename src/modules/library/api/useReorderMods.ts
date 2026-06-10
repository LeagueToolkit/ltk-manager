import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type InstalledMod } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";

/**
 * Hook to reorder mods in the active profile.
 * Accepts a partial list of mod IDs (e.g. root mods only) and automatically
 * appends any remaining mods from the cache so the backend receives the full set.
 * Uses optimistic updates for instant UI feedback.
 */
export function useReorderMods() {
  const queryClient = useQueryClient();

  return useMutation<void, AppError, string[], { previous?: InstalledMod[] }>({
    mutationFn: async (modIds) => {
      const allMods = queryClient.getQueryData<InstalledMod[]>(libraryKeys.mods());
      const fullOrder = buildFullOrder(modIds, allMods);
      const result = await api.reorderMods(fullOrder);
      return unwrapForQuery(result);
    },
    onMutate: async (modIds) => {
      await queryClient.cancelQueries({ queryKey: libraryKeys.mods() });

      const previous = queryClient.getQueryData<InstalledMod[]>(libraryKeys.mods());

      queryClient.setQueryData<InstalledMod[]>(libraryKeys.mods(), (old) => {
        if (!old) return old;

        const modMap = new Map(old.map((m) => [m.id, m]));
        const reorderedSet = new Set(modIds);
        const folderMods = old.filter((m) => !reorderedSet.has(m.id));
        const reorderedMods = modIds
          .map((id) => {
            const mod = modMap.get(id);
            if (!mod) {
              console.warn(`[useReorderMods] mod ID "${id}" not found in cache, skipping`);
            }
            return mod;
          })
          .filter(Boolean) as InstalledMod[];
        return [...reorderedMods, ...folderMods];
      });

      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) {
        queryClient.setQueryData(libraryKeys.mods(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.mods() });
    },
  });
}

/** Build the full mod ID list the backend expects: reordered IDs first, then any remaining. */
function buildFullOrder(reorderedIds: string[], allMods: InstalledMod[] | undefined): string[] {
  if (!allMods) return reorderedIds;
  const reorderedSet = new Set(reorderedIds);
  const remaining = allMods.filter((m) => !reorderedSet.has(m.id)).map((m) => m.id);
  return [...reorderedIds, ...remaining];
}
