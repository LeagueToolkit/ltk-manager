import { useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type PatcherPhase, type PatcherStatus } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { queryFn } from "@/utils/query";

import { patcherKeys } from "./keys";

export function usePatcherStatus() {
  return useQuery<PatcherStatus, AppError>({
    queryKey: patcherKeys.status(),
    queryFn: queryFn(api.getPatcherStatus),
    // Events drive normal transitions. Poll slowly as a safety net for an
    // unexpected host/thread exit that cannot emit a lifecycle notification.
    refetchInterval: 5000,
  });
}

/** Mount once near the page root; individual status consumers share its cache. */
export function usePatcherStatusEvents() {
  const queryClient = useQueryClient();

  useTauriEvent<PatcherPhase>("patcher-status-changed", (phase) => {
    queryClient.setQueryData<PatcherStatus>(patcherKeys.status(), (previous) => ({
      running: phase !== "idle",
      phase,
      overlayPrefix: phase === "idle" ? null : (previous?.overlayPrefix ?? null),
    }));
    // Patching supplies the final overlay prefix after its phase transition;
    // refresh in the background while the synchronous cache update paints now.
    queryClient.invalidateQueries({ queryKey: patcherKeys.status() });
  });
}
