import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type InstalledMod } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

import { libraryKeys } from "./keys";

interface SetModsEnabledVariables {
  modIds: string[];
  enabled: boolean;
}

/** Set many mods to one enabled state with one IPC call and one cache update. */
export function useSetModsEnabled() {
  const queryClient = useQueryClient();

  return useMutation<void, AppError, SetModsEnabledVariables, { previous?: InstalledMod[] }>({
    mutationFn: mutationFn(({ modIds, enabled }: SetModsEnabledVariables) =>
      api.setModsEnabled(modIds, enabled),
    ),
    onMutate: async ({ modIds, enabled }) => {
      await queryClient.cancelQueries({ queryKey: libraryKeys.mods() });
      const previous = queryClient.getQueryData<InstalledMod[]>(libraryKeys.mods());
      const targets = new Set(modIds);
      queryClient.setQueryData<InstalledMod[]>(libraryKeys.mods(), (old) =>
        old?.map((mod) => (targets.has(mod.id) ? { ...mod, enabled } : mod)),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      if (context?.previous) queryClient.setQueryData(libraryKeys.mods(), context.previous);
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.mods() });
    },
  });
}
