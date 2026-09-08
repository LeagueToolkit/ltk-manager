import { useQuery } from "@tanstack/react-query";

import { patcherQueries } from "./queries";

/** The patcher's phase and session, refreshed when the backend announces a change. */
export function usePatcherStatus() {
  return useQuery(patcherQueries.status());
}

/**
 * Whether a patcher run owns the library, and nothing else about it.
 *
 * A card that draws itself against `running` alone re-renders on that answer
 * rather than on every phase the run passes through.
 */
export function usePatcherRunning(): boolean {
  return useQuery({ ...patcherQueries.status(), select: (status) => status.running }).data ?? false;
}
