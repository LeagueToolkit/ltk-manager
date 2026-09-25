import { useQuery } from "@tanstack/react-query";

import { leagueInstallQueries } from "./queries";

/** Every map skin the install at `leaguePath` can show in place of the one a server names. */
export function useForcibleMapSkins(leaguePath: string | null | undefined) {
  return useQuery(leagueInstallQueries.forcibleMapSkins(leaguePath));
}
