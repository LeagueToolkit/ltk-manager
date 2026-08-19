import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";

import { api, type AppError, type GameWadEntry } from "@/lib/tauri";
import { queryFnWithArgs } from "@/utils/query";

import type { SourceEntry } from "./sourceIndex";
import { GAME_STALE_MS, gameKeys } from "./useGameWads";

/* The tree speaks plain numbers, so the wire format's bigint stays behind
   this adapter. */
function toSourceEntries(entries: GameWadEntry[]): SourceEntry[] {
  return entries.map((entry) => ({
    pathHash: entry.pathHash,
    path: entry.path,
    sizeBytes: Number(entry.sizeBytes),
  }));
}

export function gameWadEntriesOptions(wadName: string | null) {
  return queryOptions<GameWadEntry[], AppError, SourceEntry[]>({
    queryKey: gameKeys.wad(wadName ?? ""),
    queryFn: wadName ? queryFnWithArgs(api.readGameWad, wadName) : skipToken,
    staleTime: GAME_STALE_MS,
    select: toSourceEntries,
  });
}

/** One archive's entries as source entries. Pass null while the archive is unresolved. */
export function useGameWadEntries(wadName: string | null) {
  return useQuery(gameWadEntriesOptions(wadName));
}
