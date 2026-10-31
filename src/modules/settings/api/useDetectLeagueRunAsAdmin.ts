import { useQuery } from "@tanstack/react-query";

import { leagueInstallQueries } from "./queries";

/** Whether League is configured to launch as administrator, which refuses a patcher start. */
export function useDetectLeagueRunAsAdmin() {
  return useQuery(leagueInstallQueries.runAsAdmin());
}
