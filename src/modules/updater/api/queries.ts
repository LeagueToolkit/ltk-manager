import { type InfiniteData, infiniteQueryOptions } from "@tanstack/react-query";

import { api, type AppError, type ReleasePage } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { updaterKeys } from "./keys";

/** Half an hour, because the history only moves when a release ships. */
const HISTORY_STALE_MS = 30 * 60 * 1000;

/** What the project has released. */
export const updaterQueries = {
  /** Every past release, a page at a time, newest first. */
  releases: () =>
    infiniteQueryOptions<
      ReleasePage,
      AppError,
      InfiniteData<ReleasePage>,
      ReturnType<typeof updaterKeys.releases>,
      number
    >({
      queryKey: updaterKeys.releases(),
      queryFn: async ({ pageParam }) => unwrapForQuery(await api.listReleases(pageParam)),
      initialPageParam: 1,
      getNextPageParam: (last) => last.nextPage ?? undefined,
      staleTime: HISTORY_STALE_MS,
      retry: 1,
    }),
} as const;
