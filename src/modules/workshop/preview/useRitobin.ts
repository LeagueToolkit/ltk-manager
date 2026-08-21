import { useMutation, useQuery } from "@tanstack/react-query";

import { useToast } from "@/components";
import { api, type AppError, type AssetRef } from "@/lib/tauri";
import { queryFn, unwrapForQuery } from "@/utils/query";

export const ritobinKeys = {
  integration: () => ["ritobin", "integration"] as const,
};

/**
 * Whether VS Code will open a `.bin` as ritobin text.
 *
 * The answer is the Explorer verb the ritobin-lsp extension installs, read out
 * of the registry, so a user who installs it while the app is open gets the
 * action on the next refetch rather than on the next launch.
 */
export function useRitobinIntegration() {
  return useQuery<boolean, AppError>({
    queryKey: ritobinKeys.integration(),
    queryFn: queryFn(api.detectRitobinIntegration),
    retry: false,
  });
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
    mutationFn: async ({ asset, name }) =>
      unwrapForQuery(await api.openAssetInRitobin(asset, name)),
    onError: (error) => toast.error("Couldn't open in VS Code", error.message),
  });
}
