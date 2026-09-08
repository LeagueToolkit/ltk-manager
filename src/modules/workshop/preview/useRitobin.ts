import { useMutation, useQuery } from "@tanstack/react-query";

import { useToast } from "@/components";
import { errorSummary } from "@/i18n";
import { api, type AppError, type AssetRef } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { ritobinQueries } from "./queries";

export { ritobinKeys } from "./queries";

/** Whether VS Code will open a `.bin` as ritobin text. */
export function useRitobinIntegration() {
  return useQuery(ritobinQueries.integration());
}

interface OpenInRitobinArgs {
  asset: AssetRef;
  /** The file name, which a game chunk's reference holds only a hash for. */
  name?: string;
}

/**
 * Open one asset as ritobin text in VS Code.
 *
 * Nothing lands in this window, so a failure has nowhere to show but a toast.
 * The message names the remedy, which is a command inside VS Code.
 */
export function useOpenInRitobin() {
  const toast = useToast();

  return useMutation<void, AppError, OpenInRitobinArgs>({
    meta: { silentError: true },
    mutationFn: async ({ asset, name }) =>
      unwrapForQuery(await api.openAssetInRitobin(asset, name)),
    onError: (error) => toast.error("Couldn't open in VS Code", errorSummary(error)),
  });
}
