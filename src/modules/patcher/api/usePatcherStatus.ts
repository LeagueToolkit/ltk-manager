import { useQuery } from "@tanstack/react-query";

import { api, type AppError, type PatcherStatus } from "@/lib/tauri";
import { queryFn } from "@/utils/query";

import { patcherKeys } from "./keys";

/**
 * The patcher's phase and session, refreshed when the backend announces a change.
 *
 * `usePatcherStatusListener` is what carries the announcement, and it is mounted
 * once for the app. A settled status polls only until it settles, because the
 * thread flips `running` some way after it announces its last phase. An idle app
 * polls not at all.
 */
export function usePatcherStatus() {
  return useQuery<PatcherStatus, AppError>({
    queryKey: patcherKeys.status(),
    queryFn: queryFn(api.getPatcherStatus),
    refetchInterval: pollWhileUnsettled,
  });
}

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
