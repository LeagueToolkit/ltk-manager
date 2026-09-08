import { queryOptions, useQuery } from "@tanstack/react-query";

import { api, type AppError, type PlatformSupport } from "@/lib/tauri";
import { queryFn } from "@/utils/query";

/** What the host platform supports. Fixed for the life of the process. */
export const platformQueries = {
  support: () =>
    queryOptions<PlatformSupport, AppError>({
      queryKey: ["platform-support"],
      queryFn: queryFn(api.getPlatformSupport),
      staleTime: Infinity,
    }),
} as const;

/** What the host platform supports. */
export function usePlatformSupport() {
  return useQuery(platformQueries.support());
}
