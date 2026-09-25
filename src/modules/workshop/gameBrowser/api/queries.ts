import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import {
  api,
  type AppError,
  type GameDirListing,
  type GameFindResult,
  type GameIndexStats,
  type GameSearchResult,
  type GameWadEntry,
  type GameWadSummary,
  type SearchPreference,
} from "@/lib/tauri";
import { queryFn, queryFnWithArgs } from "@/utils/query";

import { extractQueries } from "../extraction/api/queries";
import type { SourceDirListing, SourceEntry } from "../utils/sourceIndex";
import { GAME_STALE_MS, gameKeys } from "./keys";

/* The tree speaks plain numbers, so the wire format's bigint stays behind these
   adapters. Directory rows arrive sorted and folded, which is the index's work. */

function toSourceListing(listing: GameDirListing): SourceDirListing {
  return {
    dirs: listing.dirs,
    files: listing.files.map((file) => ({
      pathHash: file.pathHash,
      path: file.path,
      sizeBytes: Number(file.sizeBytes),
      wad: file.wad,
    })),
  };
}

/* A scoped read names one archive, so its entries take the archive from the
   request rather than from a field the chunk list lacks. */
function toSourceEntries(entries: GameWadEntry[], wad: string): SourceEntry[] {
  return entries.map((entry) => ({
    pathHash: entry.pathHash,
    path: entry.path,
    sizeBytes: Number(entry.sizeBytes),
    wad,
  }));
}

/** The installed game as the folded index reads it. */
export const gameQueries = {
  /** Every WAD archive of the installed game. Errors when no League path is set. */
  wads: () =>
    queryOptions<GameWadSummary[], AppError>({
      queryKey: gameKeys.wads,
      queryFn: queryFn(api.getGameWads),
      staleTime: GAME_STALE_MS,
    }),

  /** What the folded index holds, once it is built. */
  index: () =>
    queryOptions<GameIndexStats, AppError>({
      queryKey: gameKeys.index,
      queryFn: queryFn(api.getGameIndex),
      staleTime: GAME_STALE_MS,
    }),

  /* The first read of a session builds the index, which walks every archive the
     install carries. Every read after it answers from what that built. */
  dir: (path: string) =>
    queryOptions<GameDirListing, AppError, SourceDirListing>({
      queryKey: gameKeys.dir(path),
      queryFn: queryFnWithArgs(api.readGameDir, path),
      staleTime: GAME_STALE_MS,
      select: toSourceListing,
    }),

  /** One archive's entries as source entries. Null while the archive is unresolved. */
  wadEntries: (wadName: string | null) =>
    queryOptions<GameWadEntry[], AppError, SourceEntry[]>({
      queryKey: gameKeys.wad(wadName ?? ""),
      queryFn: wadName ? queryFnWithArgs(api.readGameWad, wadName) : skipToken,
      staleTime: GAME_STALE_MS,
      select: (entries) => toSourceEntries(entries, wadName ?? ""),
    }),

  /* Nothing is cached across a query: a scan that a later one overtook returns
     part of an answer, and holding that under its query would hand it back as
     though it were the whole one. */
  search: (query: string, active: boolean) =>
    queryOptions<GameSearchResult, AppError>({
      queryKey: gameKeys.search(query),
      queryFn: active ? queryFnWithArgs(api.searchGameIndex, query) : skipToken,
      placeholderData: keepPreviousData,
      staleTime: 0,
      gcTime: 0,
    }),

  /** A path field's search, which ranks the files `preference` names first. */
  paths: (query: string, preference: SearchPreference, active: boolean) =>
    queryOptions<GameSearchResult, AppError>({
      queryKey: gameKeys.paths(query, preference),
      queryFn: active ? queryFnWithArgs(api.objects.searchGamePaths, query, preference) : skipToken,
      placeholderData: keepPreviousData,
      staleTime: 0,
      gcTime: 0,
    }),

  /* A pattern that does not parse resolves as an error and leaves the last good
     answer in `data`, which is what lets the box report the parse error under
     the input without blanking the results. */
  find: (pattern: string, regex: boolean, active: boolean) =>
    queryOptions<GameFindResult, AppError>({
      queryKey: gameKeys.find(pattern, regex),
      queryFn: active ? queryFnWithArgs(api.findInGameIndex, pattern, regex) : skipToken,
      placeholderData: keepPreviousData,
      staleTime: 0,
      gcTime: 0,
    }),
  extractPlan: extractQueries.extractPlan,
} as const;

export { objectIndexQueries } from "../../objectsBrowser/api/indexQueries";
