import { useQuery, useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import { api, type AppError } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";

const BatchedContext = createContext(false);

/** Whether a provider above is answering this subtree's thumbnails in one call. */
export function useThumbnailsBatched(): boolean {
  return useContext(BatchedContext);
}

interface ModThumbnailsProps {
  modIds: readonly string[];
  children: ReactNode;
}

/**
 * Answers every card's thumbnail below it in one call.
 *
 * A card asks through `useModThumbnail`, which is a cache read while this is
 * mounted: one invoke for the list rather than one per card, and one read of
 * the library index rather than one per card.
 */
export function ModThumbnails({ modIds, children }: ModThumbnailsProps) {
  const queryClient = useQueryClient();
  /* Sorted, so the same library in a different order is the same query. */
  const ids = useMemo(() => [...modIds].sort(), [modIds]);

  useQuery<Record<string, string>, AppError>({
    queryKey: libraryKeys.thumbnails(ids),
    queryFn: async () => {
      const paths = unwrapForQuery(await api.getModThumbnails(ids));

      for (const id of ids) {
        const path = paths[id];
        queryClient.setQueryData(libraryKeys.thumbnail(id), path ? convertFileSrc(path) : "");
      }

      return paths;
    },
    enabled: ids.length > 0,
    staleTime: Infinity,
  });

  return <BatchedContext value={true}>{children}</BatchedContext>;
}
