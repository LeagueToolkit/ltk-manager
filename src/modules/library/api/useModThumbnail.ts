import { useQuery } from "@tanstack/react-query";

import { modQueries } from "./queries";
import { useThumbnailsBatched } from "./useModThumbnails";

/**
 * A mod's cached thumbnail as a Tauri asset URL, empty where it has none.
 *
 * Under a `ModThumbnails` provider this is a cache read, because the provider
 * has already asked for the whole list in one call.
 */
export function useModThumbnail(modId: string) {
  const batched = useThumbnailsBatched();

  return useQuery({ ...modQueries.thumbnail(modId), enabled: !batched });
}
