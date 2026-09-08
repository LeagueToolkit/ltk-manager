import { useQuery } from "@tanstack/react-query";

import { settingsQueries } from "./queries";

/** What a fresh install shows, for the rows that offer to put it back. */
export function useSettingDefaults() {
  return useQuery(settingsQueries.defaults());
}
