import { useQuery } from "@tanstack/react-query";

import { leagueInstallQueries } from "./queries";

/** Whether `path` holds a League of Legends installation. */
export function useValidateLeaguePath(path: string | null | undefined) {
  return useQuery(leagueInstallQueries.pathValid(path));
}
