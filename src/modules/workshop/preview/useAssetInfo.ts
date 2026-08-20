import { useQuery } from "@tanstack/react-query";

import { api, type AppError, type AssetInfo, type AssetRef } from "@/lib/tauri";
import { queryFnWithArgs } from "@/utils/query";

import { assetKey } from "./assetRef";

export const previewKeys = {
  info: (asset: AssetRef) => ["asset-info", assetKey(asset)] as const,
};

/**
 * What an asset holds, beside the image the protocol draws.
 *
 * The two are separate requests on purpose. An `<img>` reports its pixel
 * dimensions and nothing else, so the container, the block format and the
 * mipmap count come over IPC while the pixels come over the protocol.
 */
export function useAssetInfo(asset: AssetRef) {
  return useQuery<AssetInfo, AppError>({
    queryKey: previewKeys.info(asset),
    queryFn: queryFnWithArgs(api.readAssetInfo, asset),
    /* A game chunk cannot change under a session, and a layer file that does
       is refetched by the tree that noticed. */
    staleTime: 5 * 60_000,
    retry: false,
  });
}
