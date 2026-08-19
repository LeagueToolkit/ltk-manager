import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type HashtableSyncReport } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

import { settingsKeys } from "./keys";

/**
 * Hook to sync the shared hashtable cache. Pass `true` to re-download every table.
 */
export function useSyncHashtables() {
  const queryClient = useQueryClient();

  return useMutation<HashtableSyncReport, AppError, boolean>({
    mutationFn: mutationFn(api.syncHashtables),
    // A failed sync can still have installed some tables, so refresh either way.
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: settingsKeys.hashtableCache() });
    },
  });
}
