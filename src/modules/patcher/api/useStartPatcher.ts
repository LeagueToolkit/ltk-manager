import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, isOk, type PatcherConfig, type Result } from "@/lib/tauri";
import { usePendingRebuildStore } from "@/stores";
import { unwrapForQuery } from "@/utils/query";

import { patcherKeys } from "./keys";

/**
 * Starts the patcher, spending the rebuild a verdict queued for the next start.
 *
 * Every start path goes through here, so the queue is honoured once whichever
 * surface asked. Per "The verdict line" in docs/ux/LEAGUE_DIAGNOSTICS.md.
 */
export async function startPatcherSpendingQueue(
  config: PatcherConfig,
): Promise<Result<void, AppError>> {
  const queue = usePendingRebuildStore.getState();
  const result = await api.startPatcher(queue.queued ? { ...config, forceRebuild: true } : config);
  if (isOk(result)) queue.clear();
  return result;
}

export function useStartPatcher() {
  const queryClient = useQueryClient();

  return useMutation<void, AppError, PatcherConfig>({
    /* useGuardedStartPatcher reports the failure. */
    meta: { silentError: true },
    mutationFn: async (config) => {
      const result = await startPatcherSpendingQueue(config);
      return unwrapForQuery(result);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: patcherKeys.status() });
    },
  });
}
