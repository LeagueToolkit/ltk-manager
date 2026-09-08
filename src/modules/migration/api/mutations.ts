import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import {
  api,
  type AppError,
  type BulkInstallResult,
  type CslolModInfo,
  type InstalledMod,
} from "@/lib/tauri";
import { libraryKeys } from "@/modules/library";
import { unwrapForQuery } from "@/utils/query";

export interface ImportCslolModsVariables {
  directory: string;
  selectedFolders: string[];
}

/** Reads and writes that bring a CSLOL install across. */
export const cslolMutations = {
  scan: () =>
    mutationOptions<CslolModInfo[], AppError, string>({
      mutationFn: async (directory) => unwrapForQuery(await api.scanCslolMods(directory)),
    }),

  importMods: (client: QueryClient) =>
    mutationOptions<BulkInstallResult, AppError, ImportCslolModsVariables>({
      mutationFn: async ({ directory, selectedFolders }) =>
        unwrapForQuery(await api.importCslolMods(directory, selectedFolders)),
      onSuccess: (result) => {
        if (result.installed.length === 0) return;
        client.setQueryData<InstalledMod[]>(libraryKeys.mods(), (old) =>
          old ? [...old, ...result.installed] : result.installed,
        );
      },
    }),
} as const;
