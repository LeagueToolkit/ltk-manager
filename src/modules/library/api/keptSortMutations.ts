import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { api, type AppError, type KeptSort } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";
import { refreshMods } from "./modMutations";

/** What setting the kept sort of some folders takes. `null` returns them to manual order. */
export interface SetKeptSortVariables {
  folderIds: string[];
  keptSort: KeptSort | null;
}

/** Writes against the sort a folder keeps its load order in. */
export const keptSortMutations = {
  set: (client: QueryClient) =>
    mutationOptions<null, AppError, SetKeptSortVariables>({
      mutationFn: async ({ folderIds, keptSort }) =>
        unwrapForQuery(await api.setKeptSort(folderIds, keptSort)),
      onSettled: () => {
        client.invalidateQueries({ queryKey: libraryKeys.folders() });
        refreshMods(client);
      },
    }),
} as const;
