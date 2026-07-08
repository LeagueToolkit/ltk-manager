import { useQuery } from "@tanstack/react-query";

import { api, type AppError, type LinkedBinOffenderInfo } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";

/**
 * Batch-fetch the linked-bin offenders from the most recent overlay build in a
 * single IPC call. Keyed by mod id; a mod absent from the map has no unresolved
 * dependencies (or wasn't part of the last build). Cheap read — no overlay build.
 */
export function useLinkedBinOffenders() {
  return useQuery<Record<string, LinkedBinOffenderInfo>, AppError>({
    queryKey: libraryKeys.linkedBinOffenders(),
    queryFn: async () => {
      const result = await api.getLinkedBinOffenders();
      return unwrapForQuery(result);
    },
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Read the linked-bin offender entry for a single mod. Returns `null` when the mod
 * had no unresolved dependencies in the last build. Reads from the shared batch
 * query, so many mod cards subscribing is a single IPC call.
 */
export function useLinkedBinOffender(modId: string) {
  return useQuery<Record<string, LinkedBinOffenderInfo>, AppError, LinkedBinOffenderInfo | null>({
    queryKey: libraryKeys.linkedBinOffenders(),
    queryFn: async () => {
      const result = await api.getLinkedBinOffenders();
      return unwrapForQuery(result);
    },
    staleTime: 5 * 60 * 1000,
    select: (data) => data[modId] ?? null,
  });
}
