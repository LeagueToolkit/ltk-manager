import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { api, type AppError, type Profile } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";

/** What renaming one profile takes. */
export interface RenameProfileVariables {
  profileId: string;
  newName: string;
}

/** Writes against the profile list. */
export const profileMutations = {
  create: (client: QueryClient) =>
    mutationOptions<Profile, AppError, string>({
      mutationFn: async (name) => unwrapForQuery(await api.createModProfile(name)),
      onSuccess: () => {
        client.invalidateQueries({ queryKey: libraryKeys.profiles() });
      },
    }),

  remove: (client: QueryClient) =>
    mutationOptions<void, AppError, string>({
      mutationFn: async (profileId) => unwrapForQuery(await api.deleteModProfile(profileId)),
      onSuccess: () => {
        client.invalidateQueries({ queryKey: libraryKeys.profiles() });
      },
    }),

  rename: (client: QueryClient) =>
    mutationOptions<Profile, AppError, RenameProfileVariables>({
      mutationFn: async ({ profileId, newName }) =>
        unwrapForQuery(await api.renameModProfile(profileId, newName)),
      onSuccess: () => {
        client.invalidateQueries({ queryKey: libraryKeys.profiles() });
        client.invalidateQueries({ queryKey: libraryKeys.activeProfile() });
      },
    }),

  switchTo: (client: QueryClient) =>
    mutationOptions<Profile, AppError, string>({
      mutationFn: async (profileId) => unwrapForQuery(await api.switchModProfile(profileId)),
      onSuccess: () => {
        client.invalidateQueries({ queryKey: libraryKeys.activeProfile() });
        client.invalidateQueries({ queryKey: libraryKeys.mods() });
      },
    }),
} as const;
