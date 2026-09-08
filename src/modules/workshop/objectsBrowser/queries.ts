import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import { api, type AppError, type ObjectDir, type ObjectFind } from "@/lib/tauri";
import { queryFnWithArgs } from "@/utils/query";

/* The leaves rather than the browser's barrel. The barrel reaches this module back
   through the documents registry mid-evaluation, its keys unbound. */
import { BUILDING_POLL_MS } from "../gameBrowser/keys";
import { objectKeys } from "./keys";

/** The object tree of the install, in the slot the index is in. */
export const objectTreeQueries = {
  /* The install's for the session. A warm or a drop settling asks again, and an
     answer the build has not given asks again each second. */
  dir: (prefix: string) =>
    queryOptions<ObjectDir, AppError>({
      queryKey: objectKeys.dir(prefix),
      queryFn: queryFnWithArgs(api.objectDir, prefix),
      staleTime: Infinity,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "building" || status === "absent" ? BUILDING_POLL_MS : false;
      },
    }),

  /* The previous answer stays on screen while the next one arrives. A pattern that
     does not parse resolves as an error and leaves the last good answer in `data`. */
  find: (pattern: string, regex: boolean, cls: string | null, active: boolean) =>
    queryOptions<ObjectFind, AppError>({
      queryKey: objectKeys.find(pattern, regex, cls),
      queryFn: active ? queryFnWithArgs(api.findObjects, pattern, regex, cls) : skipToken,
      placeholderData: keepPreviousData,
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "building" || status === "absent" ? BUILDING_POLL_MS : false;
      },
      staleTime: 0,
      gcTime: 0,
    }),
} as const;
