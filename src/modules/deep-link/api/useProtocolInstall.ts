import { useMutation, useQueryClient } from "@tanstack/react-query";

import { errorSummary } from "@/i18n";
import { api, type AppError, type InstalledMod } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "../../library/api/keys";
import { useDeepLinkStore } from "../state";

interface ProtocolInstallVars {
  url: string;
  name?: string | null;
  author?: string | null;
  source?: string | null;
}

export function useProtocolInstall() {
  const queryClient = useQueryClient();

  return useMutation<InstalledMod, AppError, ProtocolInstallVars>({
    /* The dialog draws the error this puts in the store. */
    meta: { silentError: true },
    mutationFn: async ({ url, name, author, source }) => {
      useDeepLinkStore.getState().setStatus("installing");
      const result = await api.deepLinkInstallMod(url, name, author, source);
      return unwrapForQuery(result);
    },
    onSuccess: (newMod) => {
      useDeepLinkStore.getState().setStatus("complete");
      queryClient.setQueryData<InstalledMod[]>(libraryKeys.mods(), (old) =>
        old ? [newMod, ...old] : [newMod],
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.mods() });
    },
    onError: (error) => {
      useDeepLinkStore.getState().setError(errorSummary(error));
    },
  });
}
