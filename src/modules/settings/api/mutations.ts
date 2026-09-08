import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { api, type AppError, type HashtableSyncReport, type Settings } from "@/lib/tauri";
import { mutationFn, queryFn } from "@/utils/query";

import { settingsKeys } from "./keys";

/** Writes against the app settings. */
export const settingsMutations = {
  save: (client: QueryClient) =>
    mutationOptions<void, AppError, Settings>({
      mutationFn: mutationFn(api.saveSettings),
      onSuccess: (_answer, settings) => {
        client.setQueryData(settingsKeys.settings(), settings);
        client.invalidateQueries({ queryKey: settingsKeys.setupRequired() });
      },
    }),

  /** Finding nothing answers `null` rather than rejecting. */
  autoDetectLeaguePath: () =>
    mutationOptions<string | null, AppError, void>({
      mutationFn: queryFn(api.autoDetectLeaguePath),
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
        client.invalidateQueries({ queryKey: settingsKeys.hashtableUpdates() });
      },
    }),
} as const;
