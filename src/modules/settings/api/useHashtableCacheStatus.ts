import { useQuery } from "@tanstack/react-query";

import { api, type AppError, type HashtableCacheStatus } from "@/lib/tauri";
import { queryFn } from "@/utils/query";

import { settingsKeys } from "./keys";

/**
 * Hook to fetch the state of the shared hashtable cache.
 */
export function useHashtableCacheStatus() {
  return useQuery<HashtableCacheStatus, AppError>({
    queryKey: settingsKeys.hashtableCache(),
    queryFn: queryFn(api.getHashtableCacheStatus),
  });
}
