import { useQuery } from "@tanstack/react-query";

import { leagueInstallQueries } from "./queries";

/**
 * Every WAD filename under the configured install's `DATA` directory.
 *
 * The blocklist editor's autocomplete and regex previews read this.
 */
export function useAvailableWads() {
  return useQuery(leagueInstallQueries.availableWads());
}
