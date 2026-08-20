import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";

import { api, type AppError, type GameWadEntry } from "@/lib/tauri";
import { queryFnWithArgs } from "@/utils/query";

import type { SourceEntry } from "./sourceIndex";
import { GAME_STALE_MS, gameKeys } from "./useGameWads";

/* The tree speaks plain numbers, so the wire format's bigint stays behind
   this adapter. A scoped read names one archive, so its entries take the
   archive from the request rather than from a field the chunk list lacks. */
function toSourceEntries(entries: GameWadEntry[], wad: string): SourceEntry[] {
  return entries.map((entry) => ({
    pathHash: entry.pathHash,
    path: entry.path,
    sizeBytes: Number(entry.sizeBytes),
    wad,
  }));
}

export function gameWadEntriesOptions(wadName: string | null) {
  return queryOptions<GameWadEntry[], AppError, SourceEntry[]>({
    queryKey: gameKeys.wad(wadName ?? ""),
    queryFn: wadName ? queryFnWithArgs(api.readGameWad, wadName) : skipToken,
    staleTime: GAME_STALE_MS,
    select: (entries) => toSourceEntries(entries, wadName ?? ""),
  });
}

/** One archive's entries as source entries. Pass null while the archive is unresolved. */
export function useGameWadEntries(wadName: string | null) {
  return useQuery(gameWadEntriesOptions(wadName));
}
