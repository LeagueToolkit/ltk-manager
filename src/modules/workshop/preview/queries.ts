import { queryOptions } from "@tanstack/react-query";

import { api, type AppError, type AssetInfo, type AssetRef } from "@/lib/tauri";
import { queryFn, queryFnWithArgs } from "@/utils/query";

import { assetKey } from "./assetRef";

export const previewKeys = {
  info: (asset: AssetRef) => ["asset-info", assetKey(asset)] as const,
};

export const ritobinKeys = {
  integration: () => ["ritobin", "integration"] as const,
};

/** What an asset holds, beside the image the protocol draws. */
export const previewQueries = {
  /* The info and the pixels are separate requests on purpose. An `<img>` reports
     its pixel dimensions and nothing else, so the container, the block format and
     the mipmap count come over IPC while the pixels come over the protocol.

     A game chunk cannot change under a session, and a layer file that does is
     refetched by the tree that noticed. */
  assetInfo: (asset: AssetRef) =>
    queryOptions<AssetInfo, AppError>({
      queryKey: previewKeys.info(asset),
      queryFn: queryFnWithArgs(api.readAssetInfo, asset),
      staleTime: 5 * 60_000,
      retry: false,
    }),
} as const;

/** What VS Code's ritobin integration reports about itself. */
export const ritobinQueries = {
  /* The Explorer verb the ritobin-lsp extension installs, read out of the registry,
     so a user who installs it while the app is open gets the action on the next
     refetch rather than on the next launch. */
  integration: () =>
    queryOptions<boolean, AppError>({
      queryKey: ritobinKeys.integration(),
      queryFn: queryFn(api.detectRitobinIntegration),
      retry: false,
    }),
} as const;
