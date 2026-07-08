import { useMutation } from "@tanstack/react-query";

import { api, type AppError } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

/**
 * Force a full rebuild of the active profile's overlay.
 *
 * Discards the cached overlay state so the builder regenerates every WAD from
 * scratch — the escape hatch for a stale or incorrectly-built overlay that the
 * incremental builder would otherwise reuse. The backend rejects this while the
 * patcher is running and reports progress via the usual `overlay-progress` events.
 */
export function useRebuildOverlay() {
  return useMutation<void, AppError, void>({
    mutationFn: async () => {
      const result = await api.rebuildOverlay();
      return unwrapForQuery(result);
    },
  });
}
