import { useQuery } from "@tanstack/react-query";

import type { AssetRef } from "@/lib/tauri";

import { previewQueries } from "./queries";

export { previewKeys } from "./queries";

/**
 * What an asset holds, beside the image the protocol draws.
 *
 * `enabled` false leaves the request unsent. A caller that reads the kind off
 * the name asks the bytes only for a name that has no extension.
 */
export function useAssetInfo(asset: AssetRef, enabled = true) {
  return useQuery({ ...previewQueries.assetInfo(asset), enabled });
}
