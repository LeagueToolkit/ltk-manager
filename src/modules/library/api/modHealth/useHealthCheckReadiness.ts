import { useQuery, useQueryClient } from "@tanstack/react-query";

import type { HealthCheckReadiness } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";

import { libraryKeys } from "../keys";
import { libraryPassQueries } from "../queries";

/**
 * Whether a health check can run now, for the controls that offer one.
 *
 * This answer is about a moment rather than a minute, so it keeps none of the
 * default staleness: a menu opened after the tables landed must not still be
 * saying they have not. That is only affordable because the callers are a
 * handful of controls rather than something drawn per card, which would ask
 * this once per card. While the tables are landing it asks on a timer, so the
 * row turns back into a command on its own rather than on the next thing the
 * reader does, and a sync started in Settings starts that timer through its
 * progress.
 *
 * A first answer that has not arrived, or one that failed to, reads as ready.
 * The round trip is milliseconds and the menus that ask are opened by hand, so
 * flashing a wait on every open would cost more readers than it saves - and the
 * check refuses in its own words if that guess was wrong.
 */
export function useHealthCheckReadiness(): HealthCheckReadiness {
  const queryClient = useQueryClient();

  const { data } = useQuery(libraryPassQueries.healthCheckReadiness());

  useTauriEvent("hashtable-sync-progress", () => {
    if (data === "syncing") return;
    void queryClient.invalidateQueries({ queryKey: libraryKeys.healthCheckReadiness() });
  });

  return data ?? "ready";
}
