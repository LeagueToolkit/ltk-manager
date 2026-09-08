import { keepPreviousData, queryOptions, skipToken } from "@tanstack/react-query";

import {
  api,
  type AppError,
  type DeclaredObjects,
  type ExtractPlan,
  type ExtractTarget,
  type GameDirListing,
  type GameFindResult,
  type GameIndexStats,
  type GameSearchResult,
  type GameWadEntry,
  type GameWadSummary,
  type ObjectSearch,
} from "@/lib/tauri";
import { queryFn, queryFnWithArgs } from "@/utils/query";

import { workshopKeys } from "../api/keys";
import { BUILDING_POLL_MS, GAME_STALE_MS, gameKeys } from "./keys";
import type { SourceDirListing, SourceEntry } from "./sourceIndex";

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

  /* The install changes only when Riot patches it, and the dialog is shut and
     reopened often enough that a refetch per open is pure latency. */
  extractPlan: (targets: readonly ExtractTarget[] | null) =>
    queryOptions<ExtractPlan, AppError>({
      queryKey: workshopKeys.gameExtractPlan(targets),
      queryFn: queryFn(() => api.planGameExtract([...(targets ?? [])], null)),
      enabled: targets !== null && targets.length > 0,
      staleTime: 60_000,
    }),
} as const;

/** What the object index answers, and how it reports a build still running. */
export const objectIndexQueries = {
  /* Asked whatever the Objects switch says, and asked again each second while a
     build runs. A ready answer never refetches on its own, and a warm or a drop
     settling asks again. */
  declarations: (objectHashes: readonly string[]) =>
    queryOptions<DeclaredObjects, AppError>({
      queryKey: gameKeys.declaredObjects(objectHashes),
      queryFn:
        objectHashes.length > 0
          ? queryFnWithArgs(api.declaredObjects, [...objectHashes])
          : skipToken,
      staleTime: Infinity,
      refetchInterval: (query) =>
        query.state.data?.index.status === "building" ? BUILDING_POLL_MS : false,
    }),

  /* The answer carries the slot the index is in, so a query typed while the build
     runs reads as building rather than as nothing, and asks again until the build
     lands. Nothing is cached across a query, for the reason `gameQueries.search`
     gives. */
  search: (query: string, active: boolean) =>
    queryOptions<ObjectSearch, AppError>({
      queryKey: gameKeys.objectSearch(query),
      queryFn: active ? queryFnWithArgs(api.searchObjectIndex, query) : skipToken,
      placeholderData: keepPreviousData,
      refetchInterval: (result) => {
        const status = result.state.data?.status;
        return status === "building" || status === "absent" ? BUILDING_POLL_MS : false;
      },
      staleTime: 0,
      gcTime: 0,
    }),
} as const;
