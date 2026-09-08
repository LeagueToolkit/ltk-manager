import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, type ReactNode, useContext, useMemo } from "react";

import { modQueries } from "./queries";

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

  useQuery(modQueries.thumbnails(ids, queryClient));

  return <BatchedContext value={true}>{children}</BatchedContext>;
}
