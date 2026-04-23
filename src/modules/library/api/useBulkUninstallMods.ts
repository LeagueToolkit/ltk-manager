import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type InstalledMod } from "@/lib/tauri";
import { isOk } from "@/utils/result";

import { libraryKeys } from "./keys";

export interface BulkUninstallResult {
  succeeded: string[];
  failed: Array<{ id: string; error: string }>;
}

export function useBulkUninstallMods() {
  const queryClient = useQueryClient();

  return useMutation<BulkUninstallResult, AppError, string[], { previous?: InstalledMod[] }>({
    mutationFn: async (modIds) => {
      const settled = await Promise.allSettled(modIds.map((id) => api.uninstallMod(id)));

      const succeeded: string[] = [];
      const failed: Array<{ id: string; error: string }> = [];

      settled.forEach((outcome, index) => {
        const id = modIds[index];
        if (outcome.status === "rejected") {
          failed.push({ id, error: String(outcome.reason) });
          return;
        }
        if (isOk(outcome.value)) {
          succeeded.push(id);
        } else {
          failed.push({ id, error: outcome.value.error.message });
        }
      });

      return { succeeded, failed };
    },
    onMutate: async (modIds) => {
      await queryClient.cancelQueries({ queryKey: libraryKeys.mods() });
      const previous = queryClient.getQueryData<InstalledMod[]>(libraryKeys.mods());
      const idSet = new Set(modIds);
      queryClient.setQueryData<InstalledMod[]>(libraryKeys.mods(), (old) =>
        old?.filter((mod) => !idSet.has(mod.id)),
      );
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
