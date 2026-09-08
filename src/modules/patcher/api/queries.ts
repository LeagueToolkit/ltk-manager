import { queryOptions } from "@tanstack/react-query";

import { api, type AppError, type PatcherStatus } from "@/lib/tauri";
import { queryFn } from "@/utils/query";

import { patcherKeys } from "./keys";

/**
 * How long until the next poll, or `false` where the event listener suffices.
 *
 * Only a status known to be idle stops the poll. A status nothing has answered
 * yet keeps it, so a failed first read recovers on its own rather than leaving
 * every `running` consumer undefined until the next phase change - and an idle
 * patcher announces none.
 */
function pollWhileUnsettled(query: { state: { data?: PatcherStatus } }): number | false {
  return query.state.data?.running === false ? false : 1000;
}

/** What the patcher thread reports about the run it owns. */
export const patcherQueries = {
  /* `usePatcherStatusListener` carries the announcement and is mounted once for the
     app. A settled status polls only until it settles, because the thread flips
     `running` some way after it announces its last phase. An idle app polls not at
     all. */
  status: () =>
    queryOptions<PatcherStatus, AppError>({
      queryKey: patcherKeys.status(),
      queryFn: queryFn(api.getPatcherStatus),
      refetchInterval: pollWhileUnsettled,
    }),
} as const;
