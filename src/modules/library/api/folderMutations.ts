import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { api, type AppError, type LibraryFolder } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";

/** What renaming one folder takes. */
export interface RenameFolderVariables {
  folderId: string;
  newName: string;
}

/** What toggling one folder takes. */
export interface ToggleFolderVariables {
  folderId: string;
  enabled: boolean;
}

/** The rollback a folder rename holds while its write is in flight. */
interface FolderRollback {
  previous?: LibraryFolder[];
}

/** Writes against the folders a library is arranged into. */
export const folderMutations = {
  create: (client: QueryClient) =>
    mutationOptions<LibraryFolder, AppError, string>({
      mutationFn: async (name) => unwrapForQuery(await api.createFolder(name)),
      onSettled: () => {
        client.invalidateQueries({ queryKey: libraryKeys.folders() });
        client.invalidateQueries({ queryKey: libraryKeys.folderOrder() });
      },
    }),

  rename: (client: QueryClient) =>
    mutationOptions<void, AppError, RenameFolderVariables, FolderRollback>({
      mutationFn: async ({ folderId, newName }) =>
        unwrapForQuery(await api.renameFolder(folderId, newName)),
      onMutate: async ({ folderId, newName }) => {
        await client.cancelQueries({ queryKey: libraryKeys.folders() });
        const previous = client.getQueryData<LibraryFolder[]>(libraryKeys.folders());
        client.setQueryData<LibraryFolder[]>(libraryKeys.folders(), (old) =>
          old?.map((folder) => (folder.id === folderId ? { ...folder, name: newName } : folder)),
        );
        return { previous };
      },
      onError: (_error, _variables, context) => {
        if (context?.previous) {
          client.setQueryData(libraryKeys.folders(), context.previous);
        }
      },
      onSettled: () => {
        client.invalidateQueries({ queryKey: libraryKeys.folders() });
      },
    }),

  remove: (client: QueryClient) =>
    mutationOptions<void, AppError, string>({
      mutationFn: async (folderId) => unwrapForQuery(await api.deleteFolder(folderId)),
      onSettled: () => {
        client.invalidateQueries({ queryKey: libraryKeys.folders() });
        client.invalidateQueries({ queryKey: libraryKeys.folderOrder() });
        client.invalidateQueries({ queryKey: libraryKeys.mods() });
      },
    }),

  toggle: (client: QueryClient) =>
    mutationOptions<void, AppError, ToggleFolderVariables>({
      mutationFn: async ({ folderId, enabled }) =>
        unwrapForQuery(await api.toggleFolder(folderId, enabled)),
      onSettled: () => {
        client.invalidateQueries({ queryKey: libraryKeys.mods() });
      },
    }),
} as const;
