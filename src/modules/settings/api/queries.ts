import { queryOptions } from "@tanstack/react-query";

import {
  api,
  type AppError,
  type AppInfo,
  type HashtableCacheStatus,
  type HashtableUpdateCheck,
  type Settings,
} from "@/lib/tauri";
import { queryFn, queryFnWithArgs } from "@/utils/query";

import { settingsKeys } from "./keys";
import type { ThirdPartyLicensesManifest } from "./thirdPartyLicenses";
import { fetchThirdPartyLicenses } from "./thirdPartyLicenses";

/** How long a hashtable check stands before opening the card asks GitHub again. */
const HASHTABLE_STALE_MS = 30 * 60 * 1000;

/** The settings themselves, and the tables a settings page reads beside them. */
export const settingsQueries = {
  current: () =>
    queryOptions<Settings, AppError>({
      queryKey: settingsKeys.settings(),
      queryFn: queryFn(api.getSettings),
    }),

  /* A fresh install's values cannot change while the app runs, so this is a
     fetch-once table rather than a cache. */
  defaults: () =>
    queryOptions<Settings, AppError>({
      queryKey: settingsKeys.defaults(),
      queryFn: queryFn(api.getDefaultSettings),
      staleTime: Infinity,
      gcTime: Infinity,
    }),

  setupRequired: () =>
    queryOptions<boolean, AppError>({
      queryKey: settingsKeys.setupRequired(),
      queryFn: queryFn(api.checkSetupRequired),
    }),

  appInfo: () =>
    queryOptions<AppInfo, AppError>({
      queryKey: settingsKeys.appInfo(),
      queryFn: queryFn(api.getAppInfo),
      staleTime: Infinity,
    }),

  thirdPartyLicenses: () =>
    queryOptions<ThirdPartyLicensesManifest, Error>({
      queryKey: settingsKeys.thirdPartyLicenses(),
      queryFn: fetchThirdPartyLicenses,
      staleTime: Infinity,
    }),

  /* Refetched on focus, because the identity rotates at midnight UTC and a window
     left open across it would otherwise show yesterday's. */
  telemetryIdentity: () =>
    queryOptions<string | null, AppError>({
      queryKey: settingsKeys.telemetryIdentity(),
      queryFn: queryFn(api.diagnostics.telemetryIdentity),
    }),
} as const;

/** What the configured League install answers about itself. */
export const leagueInstallQueries = {
  /* Idle while there is no path, so `undefined` covers both "not checked" and a
     check that failed. */
  pathValid: (path: string | null | undefined) =>
    queryOptions<boolean, AppError>({
      queryKey: settingsKeys.leaguePathValid(path ?? ""),
      queryFn: queryFnWithArgs(api.validateLeaguePath, path ?? ""),
      enabled: !!path,
      retry: false,
    }),

  /* The WAD set is effectively static for an install, so it stays fresh for an
     hour. Invalidate `settingsKeys.availableWads()` when the league path changes. */
  availableWads: () =>
    queryOptions<string[], AppError>({
      queryKey: settingsKeys.availableWads(),
      queryFn: queryFn(api.listAvailableWads),
      staleTime: 60 * 60 * 1000,
      retry: false,
    }),

  /* The AppCompatFlags `RUNASADMIN` layer rarely changes, so it stays fresh for
     a few minutes. */
  runAsAdmin: () =>
    queryOptions<boolean, AppError>({
      queryKey: settingsKeys.leagueRunAsAdmin(),
      queryFn: queryFn(api.detectLeagueRunAsAdmin),
      staleTime: 5 * 60 * 1000,
      retry: false,
    }),
} as const;

/** The shared hashtable cache, and what a release publishes against it. */
export const hashtableQueries = {
  cacheStatus: () =>
    queryOptions<HashtableCacheStatus, AppError>({
      queryKey: settingsKeys.hashtableCache(),
      queryFn: queryFn(api.getHashtableCacheStatus),
    }),

  /* Reaches the network, so it is paced: one answer stands for half an hour and
     no refetch follows a focus or a reconnect. A failure is not retried, and the
     card falls back to what the cache holds. */
  updateCheck: () =>
    queryOptions<HashtableUpdateCheck, AppError>({
      queryKey: settingsKeys.hashtableUpdates(),
      queryFn: queryFn(api.checkHashtableUpdates),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
      staleTime: HASHTABLE_STALE_MS,
    }),
} as const;
