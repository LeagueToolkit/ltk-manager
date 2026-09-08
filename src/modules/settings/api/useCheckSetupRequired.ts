import { useQuery } from "@tanstack/react-query";

import { settingsQueries } from "./queries";

/** Whether the league path is still unconfigured, so first-run setup is owed. */
export function useCheckSetupRequired() {
  return useQuery(settingsQueries.setupRequired());
}
