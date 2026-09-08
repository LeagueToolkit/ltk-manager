import { useQuery } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";

import { api, type AppError } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";
import { useThumbnailsBatched } from "./useModThumbnails";

/**
 * A mod's cached thumbnail as a Tauri asset URL, empty where it has none.
 *
 * Under a `ModThumbnails` provider this is a cache read, because the provider
 * has already asked for the whole list in one call.
 */
export function useModThumbnail(modId: string) {
  const batched = useThumbnailsBatched();

  return useQuery<string, AppError>({
    queryKey: libraryKeys.thumbnail(modId),
    queryFn: async () => {
      const result = await api.getModThumbnail(modId);
      const path = unwrapForQuery(result);
      return path ? convertFileSrc(path) : "";
    },
    enabled: !batched,
    staleTime: Infinity,
  });
}
