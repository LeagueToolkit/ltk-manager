import {
  mutationOptions,
  type QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import {
  type AddFoldersReport,
  api,
  type AppError,
  type ConvertFolderArgs,
  type OpenedProjectFolder,
  type WorkshopProject,
} from "@/lib/tauri";
import { queryFn, unwrapForQuery } from "@/utils/query";

import { workshopKeys } from "../../shared/api/keys";

/** The folders opened from outside the workshop folder, missing ones included. */
export const projectFolderQueries = {
  opened: () =>
    queryOptions<OpenedProjectFolder[], AppError>({
      queryKey: workshopKeys.openedFolders(),
      queryFn: queryFn(api.projectFolders.list),
    }),
} as const;

/** Reread the project list and the opened folders after the list changed. */
export function refreshProjectFolders(client: QueryClient): Promise<void> {
  return Promise.all([
    client.invalidateQueries({ queryKey: workshopKeys.projects(), exact: true }),
    client.invalidateQueries({ queryKey: workshopKeys.openedFolders() }),
  ]).then(() => undefined);
}

/** Where a moved folder is now. */
export interface FolderRelocation {
  oldPath: string;
  newPath: string;
}

/** Ways a folder on disk joins or leaves the workshop's list. */
export const projectFolderMutations = {
  open: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, string>({
      mutationFn: async (path) => unwrapForQuery(await api.projectFolders.open(path)),
      onSuccess: () => refreshProjectFolders(client),
    }),

  convert: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, ConvertFolderArgs>({
      mutationFn: async (args) => unwrapForQuery(await api.projectFolders.convert(args)),
      onSuccess: () => refreshProjectFolders(client),
    }),

  addAll: (client: QueryClient) =>
    mutationOptions<AddFoldersReport, AppError, readonly string[]>({
      mutationFn: async (paths) => unwrapForQuery(await api.projectFolders.addAll(paths)),
      onSuccess: () => refreshProjectFolders(client),
    }),

  forget: (client: QueryClient) =>
    mutationOptions<null, AppError, string>({
      mutationFn: async (path) => unwrapForQuery(await api.projectFolders.forget(path)),
      onSuccess: () => refreshProjectFolders(client),
    }),

  relocate: (client: QueryClient) =>
    mutationOptions<WorkshopProject, AppError, FolderRelocation>({
      mutationFn: async ({ oldPath, newPath }) =>
        unwrapForQuery(await api.projectFolders.relocate(oldPath, newPath)),
      onSuccess: () => refreshProjectFolders(client),
    }),
} as const;

/** The opened folders, as the grid's missing cards and the start page read them. */
export function useOpenedFolders() {
  return useQuery(projectFolderQueries.opened());
}

/** Open a project folder, adding it to the list when it is outside the workshop folder. */
export function useOpenProjectFolder() {
  return useMutation(projectFolderMutations.open(useQueryClient()));
}

/** Turn a folder without a config into a project. */
export function useConvertFolder() {
  return useMutation(projectFolderMutations.convert(useQueryClient()));
}

/** Add every project and fantome mod under a folder to the list. */
export function useAddProjectFolders() {
  return useMutation(projectFolderMutations.addAll(useQueryClient()));
}

/** Remove a folder from the list, leaving its files. */
export function useForgetProjectFolder() {
  return useMutation(projectFolderMutations.forget(useQueryClient()));
}

/** Point a missing folder's entry at where the folder is now. */
export function useRelocateProjectFolder() {
  return useMutation(projectFolderMutations.relocate(useQueryClient()));
}
