import {
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { api, type AppError, type GameDirListing, type GameIndexStats } from "@/lib/tauri";
import { mutationFn, queryFn, queryFnWithArgs } from "@/utils/query";

import type { SourceDirListing } from "./sourceIndex";
import { GAME_STALE_MS, gameKeys } from "./useGameWads";

/* The tree speaks plain numbers, so the wire format's bigint stays behind this
   adapter. Directory rows arrive sorted and folded, which is the index's work. */
function toSourceListing(listing: GameDirListing): SourceDirListing {
  return {
    dirs: listing.dirs,
    files: listing.files.map((file) => ({
      pathHash: file.pathHash,
      path: file.path,
      sizeBytes: Number(file.sizeBytes),
    })),
  };
}

const EMPTY_LISTING: SourceDirListing = { dirs: [], files: [] };

function gameDirOptions(path: string) {
  return queryOptions<GameDirListing, AppError, SourceDirListing>({
    queryKey: gameKeys.dir(path),
    queryFn: queryFnWithArgs(api.readGameDir, path),
    staleTime: GAME_STALE_MS,
    select: toSourceListing,
  });
}

/**
 * One directory of the folded game index, `""` for the root.
 *
 * The first read of a session builds the index, which walks every archive the
 * install carries. Every read after it answers from what that built.
 */
export function useGameDir(path: string) {
  return useQuery(gameDirOptions(path));
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

  return useQueries({ queries: paths.map(gameDirOptions), combine });
}

/** What the folded index holds, once it is built. */
export function useGameIndex() {
  return useQuery<GameIndexStats, AppError>({
    queryKey: gameKeys.index,
    queryFn: queryFn(api.getGameIndex),
    staleTime: GAME_STALE_MS,
  });
}

/** Drop the built index, so the next read walks the install again. */
export function useRefreshGameIndex() {
  const queryClient = useQueryClient();

  return useMutation<void, AppError, void>({
    mutationFn: mutationFn(api.refreshGameIndex),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: gameKeys.index });
      queryClient.invalidateQueries({ queryKey: gameKeys.dirs });
      queryClient.invalidateQueries({ queryKey: gameKeys.wads });
    },
  });
}
