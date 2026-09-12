import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";

import {
  api,
  type AppError,
  type ChecksumMismatchInfo,
  type HealthCheckReadiness,
  type HealthSweepState,
  type InstalledMod,
  type LayoutMigrationState,
  type LibraryFolder,
  type LinkedBinOffenderInfo,
  type ModDocument,
  type ModHealthVerdict,
  type ModWadReport,
  type Profile,
} from "@/lib/tauri";
import { queryFn, unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";

/** How long a report of the last overlay build stands before it is asked for again. */
const REPORT_STALE_MS = 5 * 60 * 1000;

/** How often to ask again while the sweep has not reported. */
export const SWEEP_POLL_MS = 400;

/** How often to ask again while the startup migration pass has not reported. */
export const MIGRATION_POLL_MS = 400;

/** How often to ask again while the hashtables are still landing. */
export const READINESS_POLL_MS = 1000;

/** The installed mods, and everything the last overlay build reported about them. */
export const modQueries = {
  all: () =>
    queryOptions<InstalledMod[], AppError>({
      queryKey: libraryKeys.mods(),
      queryFn: queryFn(api.getInstalledMods),
    }),

  /* The answer is the final asset URL rather than a raw path, so the batch below
     can inject one per mod with `setQueryData`. */
  thumbnail: (modId: string) =>
    queryOptions<string, AppError>({
      queryKey: libraryKeys.thumbnail(modId),
      queryFn: async () => {
        const path = unwrapForQuery(await api.getModThumbnail(modId));
        return path ? convertFileSrc(path) : "";
      },
      staleTime: Infinity,
    }),

  /* One invoke for the list rather than one per card, and one read of the library
     index rather than one per card. Each mod's own entry is seeded as the batch
     resolves rather than in an effect after it, so a card never paints a frame
     without the thumbnail the batch already holds. */
  thumbnails: (modIds: readonly string[], seed: QueryClient) =>
    queryOptions<Record<string, string>, AppError>({
      queryKey: libraryKeys.thumbnails(modIds),
      queryFn: async () => {
        const paths = unwrapForQuery(await api.getModThumbnails([...modIds]));
        for (const id of modIds) {
          const path = paths[id];
          seed.setQueryData(libraryKeys.thumbnail(id), path ? convertFileSrc(path) : "");
        }
        return paths;
      },
      enabled: modIds.length > 0,
      staleTime: Infinity,
    }),

  /* Every batch below answers one IPC call for the whole library, and a card
     narrows to its own entry with `select`. Many cards subscribing is one call. */

  wadReports: () =>
    queryOptions<Record<string, ModWadReport>, AppError>({
      queryKey: libraryKeys.wadReports(),
      queryFn: async () => unwrapForQuery(await api.getAllModWadReports()),
      staleTime: REPORT_STALE_MS,
    }),

  linkedBinOffenders: () =>
    queryOptions<Record<string, LinkedBinOffenderInfo>, AppError>({
      queryKey: libraryKeys.linkedBinOffenders(),
      queryFn: async () => unwrapForQuery(await api.getLinkedBinOffenders()),
      staleTime: REPORT_STALE_MS,
    }),

  checksumMismatches: () =>
    queryOptions<Record<string, ChecksumMismatchInfo[]>, AppError>({
      queryKey: libraryKeys.checksumMismatches(),
      queryFn: async () => unwrapForQuery(await api.getChecksumMismatches()),
      staleTime: REPORT_STALE_MS,
    }),

  healthVerdicts: () =>
    queryOptions<Record<string, ModHealthVerdict>, AppError>({
      queryKey: libraryKeys.modHealthVerdicts(),
      queryFn: async () => unwrapForQuery(await api.getModHealthVerdicts()),
      staleTime: REPORT_STALE_MS,
    }),

  /* A mod's own text, which changes only when the mod is reinstalled, so the
     answer stands for the session rather than being asked for again on focus. */

  readme: (modId: string) =>
    queryOptions<ModDocument, AppError>({
      queryKey: libraryKeys.readme(modId),
      queryFn: async () => unwrapForQuery(await api.getModReadme(modId)),
      staleTime: Infinity,
    }),

  /* Reading one costs an archive mount, so the ask is the expand itself and the
     answer outlives the fold closing again: once per session, never to disk. */
  licenseText: (modId: string) =>
    queryOptions<ModDocument, AppError>({
      queryKey: libraryKeys.licenseText(modId),
      queryFn: async () => unwrapForQuery(await api.getModLicenseText(modId)),
      staleTime: Infinity,
      gcTime: Infinity,
    }),
} as const;

/** Profiles, and which of them is switched on. */
export const profileQueries = {
  all: () =>
    queryOptions<Profile[], AppError>({
      queryKey: libraryKeys.profiles(),
      queryFn: queryFn(api.listModProfiles),
    }),

  active: () =>
    queryOptions<Profile, AppError>({
      queryKey: libraryKeys.activeProfile(),
      queryFn: queryFn(api.getActiveModProfile),
    }),
} as const;

/** The folders a library is arranged into, and the order they sit in. */
export const folderQueries = {
  all: () =>
    queryOptions<LibraryFolder[], AppError>({
      queryKey: libraryKeys.folders(),
      queryFn: queryFn(api.getFolders),
    }),

  order: () =>
    queryOptions<string[], AppError>({
      queryKey: libraryKeys.folderOrder(),
      queryFn: queryFn(api.getFolderOrder),
    }),
} as const;

/** What the passes that run at startup report about themselves. */
export const libraryPassQueries = {
  /* The backend answers `pending` until the startup pass has something to say,
     which is what closes the gap where neither an event nor an ask would land. */
  migrationState: () =>
    queryOptions<LayoutMigrationState, AppError>({
      queryKey: libraryKeys.migrationState(),
      queryFn: queryFn(api.getLayoutMigrationState),
      refetchInterval: (query) =>
        query.state.data?.status === "pending" ? MIGRATION_POLL_MS : false,
    }),

  /* Both unfinished states are still owed an answer, and asking covers the sliver
     between a caller mounting and its listener being registered, where the
     finishing event would reach nobody. */
  healthSweep: () =>
    queryOptions<HealthSweepState, AppError>({
      queryKey: libraryKeys.healthSweep(),
      queryFn: queryFn(api.getHealthSweep),
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "pending" || status === "running" ? SWEEP_POLL_MS : false;
      },
    }),

  /* About a moment rather than a minute, so it keeps none of the default staleness:
     a menu opened after the tables landed must not still be saying they have not.
     While they are landing it asks on a timer, so the row turns back into a command
     on its own rather than on the next thing the reader does. */
  healthCheckReadiness: () =>
    queryOptions<HealthCheckReadiness, AppError>({
      queryKey: libraryKeys.healthCheckReadiness(),
      queryFn: queryFn(api.getHealthCheckReadiness),
      staleTime: 0,
      refetchInterval: (query) => (query.state.data === "syncing" ? READINESS_POLL_MS : false),
    }),
} as const;

/** Every installed mod. */
export function useInstalledMods() {
  return useQuery(modQueries.all());
}

/** Every profile. */
export function useProfiles() {
  return useQuery(profileQueries.all());
}

/** The profile currently switched on. */
export function useActiveProfile() {
  return useQuery(profileQueries.active());
}

/** Every library folder. */
export function useFolders() {
  return useQuery(folderQueries.all());
}

/** The order the folders sit in. */
export function useFolderOrder() {
  return useQuery(folderQueries.order());
}
