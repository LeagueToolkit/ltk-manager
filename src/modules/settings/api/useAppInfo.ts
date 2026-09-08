import { useQuery } from "@tanstack/react-query";

import { settingsQueries } from "./queries";

/** What the running build reports about itself. */
export function useAppInfo() {
  return useQuery(settingsQueries.appInfo());
}
