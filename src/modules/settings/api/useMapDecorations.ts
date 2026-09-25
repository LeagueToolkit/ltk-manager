import { useQuery } from "@tanstack/react-query";

import { leagueInstallQueries } from "./queries";

/** Every map decoration a mutator switches in the install at `leaguePath`. */
export function useMapDecorations(leaguePath: string | null | undefined) {
  return useQuery(leagueInstallQueries.mapDecorations(leaguePath));
}
