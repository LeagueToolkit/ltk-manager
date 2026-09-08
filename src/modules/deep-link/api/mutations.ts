import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { errorSummary } from "@/i18n";
import { api, type AppError, type InstalledMod } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "../../library/api/keys";
import { useDeepLinkStore } from "../state";

export interface ProtocolInstallVariables {
  url: string;
  name?: string | null;
  author?: string | null;
  source?: string | null;
}

/** The install a `ltk://` link asks for. */
export const deepLinkMutations = {
  install: (client: QueryClient) =>
    mutationOptions<InstalledMod, AppError, ProtocolInstallVariables>({
      /* The dialog draws the error this puts in the store. */
      meta: { silentError: true },
      mutationFn: async ({ url, name, author, source }) => {
        useDeepLinkStore.getState().setStatus("installing");
        return unwrapForQuery(await api.deepLinkInstallMod(url, name, author, source));
      },
      onSuccess: (installed) => {
        useDeepLinkStore.getState().setStatus("complete");
        client.setQueryData<InstalledMod[]>(libraryKeys.mods(), (old) =>
          old ? [installed, ...old] : [installed],
        );
      },
      onError: (error) => {
        useDeepLinkStore.getState().setError(errorSummary(error));
      },
      onSettled: () => {
        client.invalidateQueries({ queryKey: libraryKeys.mods() });
      },
    }),
} as const;
