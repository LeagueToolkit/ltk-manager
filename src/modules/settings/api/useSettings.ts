import { useQuery } from "@tanstack/react-query";

import { settingsQueries } from "./queries";

/** The app settings as saved. */
export function useSettings() {
  return useQuery(settingsQueries.current());
}
