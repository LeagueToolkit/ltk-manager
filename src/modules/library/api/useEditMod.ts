import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type EditModMetadataArgs, type InstalledMod } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";

interface EditModVariables {
  modId: string;
  metadata: EditModMetadataArgs;
}

/**
 * Hook to edit a mod's metadata.
 * Returns the updated InstalledMod.
 */
export function useEditMod() {
  const queryClient = useQueryClient();

  return useMutation<InstalledMod, AppError, EditModVariables>({
    mutationFn: async ({ modId, metadata }) => {
      const result = await api.editModMetadata(modId, metadata);
      return unwrapForQuery(result);
    },
    onSuccess: (updatedMod) => {
      // Update the cache with the new mod
      queryClient.setQueryData<InstalledMod[]>(libraryKeys.mods(), (old) =>
        old?.map((mod) => (mod.id === updatedMod.id ? updatedMod : mod)),
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.mods() });
    },
  });
}
