import { useQuery } from "@tanstack/react-query";

import { leagueInstallQueries } from "./queries";

/**
 * Whether League is configured to launch as administrator.
 *
 * The patcher auto-elevates the injection host when it is, whatever
 * `elevateInjector` says, so the settings page explains the UAC prompt with this.
 */
export function useDetectLeagueRunAsAdmin() {
  return useQuery(leagueInstallQueries.runAsAdmin());
}
