import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { api, type AppError, isOk, type PatcherConfig, type Result } from "@/lib/tauri";
import { usePatcherSessionStore, usePendingRebuildStore } from "@/stores";
import { unwrapForQuery } from "@/utils/query";

import { patcherKeys } from "./keys";

/**
 * Start the patcher, spending the rebuild a verdict queued for the next start.
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

/** Writes that drive a patcher run. */
export const patcherMutations = {
  start: (client: QueryClient) =>
    mutationOptions<void, AppError, PatcherConfig>({
      /* useGuardedStartPatcher reports the failure. */
      meta: { silentError: true },
      mutationFn: async (config) => unwrapForQuery(await startPatcherSpendingQueue(config)),
      onSuccess: () => {
        client.invalidateQueries({ queryKey: patcherKeys.status() });
      },
    }),

  /* Resolves once the backend has set its stop flag, which is not when the
     patcher has stopped, so the shared `stopping` flag is raised here and lowered
     by `useClearStoppingOnIdle` once the session actually ends. A caller keyed off
     `isPending` alone would show a stopping state for a few milliseconds of a
     multi-second wait. */
  stop: (client: QueryClient) =>
    mutationOptions<void, AppError, void>({
      mutationFn: async () => unwrapForQuery(await api.stopPatcher()),
      onMutate: () => {
        usePatcherSessionStore.getState().setStopping(true);
      },
      onSuccess: () => {
        client.invalidateQueries({ queryKey: patcherKeys.status() });
      },
      /* Nothing is unwinding if the request itself failed, so the flag comes
         straight back down. `NotRunning` is the ordinary case here, from a stop
         racing a session that had already ended. */
      onError: () => {
        usePatcherSessionStore.getState().setStopping(false);
      },
    }),

  /* Discards the cached overlay state so the builder regenerates every WAD from
     scratch. The backend refuses this while the patcher is running and reports
     progress through the usual `overlay-progress` events. */
  rebuildOverlay: () =>
    mutationOptions<void, AppError, void>({
      /* Every caller reports: PatchingSection, IncidentDetail, useRebuildOverlayAction. */
      meta: { silentError: true },
      mutationFn: async () => unwrapForQuery(await api.rebuildOverlay()),
    }),
} as const;
