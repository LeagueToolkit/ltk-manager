import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { m } from "@/i18n";
import {
  api,
  type AppError,
  type DataArea,
  type DataMovePlan,
  type HashtableSyncReport,
  type Settings,
} from "@/lib/tauri";
import { dropPlacements } from "@/modules/viewport/assets/api/placements";
import { mutationFn } from "@/utils/query";

import { settingsKeys } from "./keys";

/** Writes against the app settings. */
export const settingsMutations = {
  /* Saves run one at a time and show at once, so a second change merged onto the
     first reaches the backend after it rather than racing it. A refused save reads
     the settings back. */
  save: (client: QueryClient) =>
    mutationOptions<null, AppError, Settings>({
      mutationFn: mutationFn(api.saveSettings),
      scope: { id: "settings" },
      onMutate: (settings) => {
        client.setQueryData(settingsKeys.settings(), settings);
      },
      onError: () => {
        client.invalidateQueries({ queryKey: settingsKeys.settings() });
      },
      onSuccess: () => {
        client.invalidateQueries({ queryKey: settingsKeys.setupRequired() });
      },
      onSettled: () => {
        // An optimistic path change can query before the backend saves that path.
        client.invalidateQueries({ queryKey: settingsKeys.patchStatus() });
      },
    }),

  exportSettings: () =>
    mutationOptions<null, AppError, string>({
      mutationFn: mutationFn(api.exportSettings),
      meta: { errorTitle: m.settings_backup_export_failed_title() },
    }),

  /** Answers the backup read over the current settings, unsaved. */
  readSettingsBackup: () =>
    mutationOptions<Settings, AppError, string>({
      mutationFn: mutationFn(api.readSettingsBackup),
      meta: { errorTitle: m.settings_backup_read_failed_title() },
    }),

  /** Finding nothing answers `null` rather than rejecting. */
  autoDetectLeaguePath: () =>
    mutationOptions<string | null, AppError, void>({
      mutationFn: mutationFn(api.autoDetectLeaguePath),
    }),

  /* The three data writes below toast their own failure, which names the area or the folder. */

  /** `null` plans a move to the app data directory. */
  planDataMove: () =>
    mutationOptions<DataMovePlan, AppError, string | null>({
      mutationFn: mutationFn(api.planDataMove),
      meta: { silentError: true },
    }),

  clearDataArea: (client: QueryClient) =>
    mutationOptions<null, AppError, DataArea>({
      mutationFn: mutationFn(api.clearDataArea),
      meta: { silentError: true },
      onSettled: () => {
        client.invalidateQueries({ queryKey: settingsKeys.dataUsage() });
      },
    }),

  /** A move that succeeds restarts the app, so its answer never arrives. */
  moveData: () =>
    mutationOptions<null, AppError, string | null>({
      mutationFn: mutationFn(api.moveData),
      meta: { silentError: true },
    }),
} as const;

/** Writes against the shared hashtable cache. */
export const hashtableMutations = {
  /* `true` re-downloads every table. A failed sync can still have installed
     some, so the cache is refreshed either way. */
  sync: (client: QueryClient) =>
    mutationOptions<HashtableSyncReport, AppError, boolean>({
      mutationFn: mutationFn(api.syncHashtables),
      onSettled: () => {
        client.invalidateQueries({ queryKey: settingsKeys.hashtableCache() });
        client.invalidateQueries({ queryKey: settingsKeys.patchStatus() });
        client.invalidateQueries({ queryKey: settingsKeys.hashtableUpdates() });
        /* The sync drops the game index behind it, so every placement read out of the
           old one now names a file by a name that install no longer resolves. */
        dropPlacements(client);
      },
    }),
} as const;

/** Writes against the diagnostics identity the Privacy card shows. */
export const telemetryMutations = {
  /* The answer is the new pseudonym, so it seeds the query rather than
     invalidating it and asking the backend what it just answered. */
  resetSecret: (client: QueryClient) =>
    mutationOptions<string | null, AppError, void>({
      mutationFn: mutationFn(api.diagnostics.resetTelemetrySecret),
      onSuccess: (identity) => {
        client.setQueryData(settingsKeys.telemetryIdentity(), identity);
      },
    }),
} as const;
