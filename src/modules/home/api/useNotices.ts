import { useQuery } from "@tanstack/react-query";

import { homeQueries } from "./queries";

/** The notices that concern this build right now, newest first. */
export function useNotices() {
  return useQuery(homeQueries.notices());
}
