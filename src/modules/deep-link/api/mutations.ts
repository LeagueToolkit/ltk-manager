import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { api, type AppError, type InstalledMod, type InstallOutcome } from "@/lib/tauri";
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
    mutationOptions<InstallOutcome, AppError, ProtocolInstallVariables>({
      /* The dialog draws the error this puts in the store. */
      meta: { silentError: true },
      mutationFn: async ({ url, name, author, source }) => {
        useDeepLinkStore.getState().setStatus("installing");
        return unwrapForQuery(await api.deepLinkInstallMod(url, name, author, source));
      },
      onSuccess: (outcome) => {
        if (outcome.kind === "alreadyInstalled") {
          useDeepLinkStore.getState().setStatus("existing");
          return;
        }

        if (outcome.kind === "updated") {
          useDeepLinkStore.getState().setStatus("updated");
          return;
        }

        useDeepLinkStore.getState().setStatus("complete");
        client.setQueryData<InstalledMod[]>(libraryKeys.mods(), (old) =>
          old ? [outcome.mod, ...old] : [outcome.mod],
        );
      },
      onError: (error) => {
        useDeepLinkStore.getState().setError(error);
      },
      onSettled: () => {
        client.invalidateQueries({ queryKey: libraryKeys.mods() });
      },
    }),
} as const;
