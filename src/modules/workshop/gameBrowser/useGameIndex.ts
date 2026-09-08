import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { api, type AppError } from "@/lib/tauri";
import { useSearchObjects } from "@/stores";
import { mutationFn } from "@/utils/query";

import { gameKeys } from "./keys";
import { gameQueries } from "./queries";
import type { SourceDirListing } from "./sourceIndex";
import { useWarmObjectIndex } from "./useObjectIndex";

const EMPTY_LISTING: SourceDirListing = { dirs: [], files: [] };

/**
 * One directory of the folded game index, `""` for the root.
 *
 * The first read of a session builds the index, which walks every archive the
 * install carries. Every read after it answers from what that built.
 */
export function useGameDir(path: string) {
  return useQuery(gameQueries.dir(path));
}

/**
 * Every expanded directory at once, null where a listing is still in flight.
 *
 * `paths` must be referentially stable across renders, or the combined map
 * loses its memoization and the whole tree rebuilds.
 */
export function useGameDirs(
  paths: readonly string[],
): ReadonlyMap<string, SourceDirListing | null> {
  const combine = useCallback(
    (results: ReadonlyArray<{ data?: SourceDirListing; isError: boolean }>) => {
      const byPath = new Map<string, SourceDirListing | null>();
      paths.forEach((path, index) => {
        const result = results[index];
        /* A directory the index no longer holds - a game patch under an
           expansion restored from disk - reads as empty rather than as a row
           that spins forever. */
        byPath.set(path, result?.data ?? (result?.isError ? EMPTY_LISTING : null));
      });
      return byPath;
    },
    [paths],
  );

  return useQueries({ queries: paths.map((path) => gameQueries.dir(path)), combine });
}

/** What the folded index holds, once it is built. */
export function useGameIndex() {
  return useQuery(gameQueries.index());
}

/**
 * Drop the built index, so the next read walks the install again.
 *
 * The object index goes with it, and is warmed again while the Objects switch
 * is on, because the game index it is fed by has just been declared stale.
 */
export function useRefreshGameIndex() {
  const queryClient = useQueryClient();
  const searchObjects = useSearchObjects();
  const warmObjects = useWarmObjectIndex();
  const warmMutate = warmObjects.mutate;

  return useMutation<void, AppError, void>({
    mutationFn: mutationFn(api.refreshGameIndex),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: gameKeys.index });
      queryClient.invalidateQueries({ queryKey: gameKeys.dirs });
      queryClient.invalidateQueries({ queryKey: gameKeys.wads });
      queryClient.invalidateQueries({ queryKey: gameKeys.objectSearches });
      if (searchObjects) warmMutate();
    },
  });
}
