import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { api, type AppError, type InstalledMod } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";
import { holdMods, type ModsRollback, refreshMods, releaseMods } from "./modMutations";

export interface MoveModVariables {
  modId: string;
  folderId: string;
}

export interface ReorderFolderModsVariables {
  folderId: string;
  modIds: string[];
}

/** Invalidate what a move between folders changes. */
function refreshPlacement(client: QueryClient): void {
  client.invalidateQueries({ queryKey: libraryKeys.folders() });
  refreshMods(client);
}

/** Writes that change where a mod sits rather than what it is. */
export const modOrderMutations = {
  /* Takes a partial list - the root mods alone, say - and appends the rest from
     the cache, because the backend is given the whole order or none of it. */
  reorder: (client: QueryClient) =>
    mutationOptions<void, AppError, string[], ModsRollback>({
      mutationFn: async (modIds) => {
        const all = client.getQueryData<InstalledMod[]>(libraryKeys.mods());
        return unwrapForQuery(await api.reorderMods(fullOrder(modIds, all)));
      },
      onMutate: (modIds) =>
        holdMods(client, (mods) => {
          const byId = new Map(mods.map((mod) => [mod.id, mod]));
          const moved = new Set(modIds);
          const reordered = modIds
            .map((id) => byId.get(id))
            .filter((mod): mod is InstalledMod => mod !== undefined);
          return [...reordered, ...mods.filter((mod) => !moved.has(mod.id))];
        }),
      onError: (_error, _variables, context) => releaseMods(client, context),
      onSettled: () => refreshMods(client),
    }),

  moveToFolder: (client: QueryClient) =>
    mutationOptions<void, AppError, MoveModVariables>({
      mutationFn: async ({ modId, folderId }) =>
        unwrapForQuery(await api.moveModToFolder(modId, folderId)),
      onSettled: () => refreshPlacement(client),
    }),

  reorderInFolder: (client: QueryClient) =>
    mutationOptions<void, AppError, ReorderFolderModsVariables>({
      mutationFn: async ({ folderId, modIds }) =>
        unwrapForQuery(await api.reorderFolderMods(folderId, modIds)),
      onSettled: () => refreshPlacement(client),
    }),

  reorderFolders: (client: QueryClient) =>
    mutationOptions<void, AppError, string[]>({
      mutationFn: async (folderOrder) => unwrapForQuery(await api.reorderFolders(folderOrder)),
      onSettled: () => {
        client.invalidateQueries({ queryKey: libraryKeys.folderOrder() });
        refreshMods(client);
      },
    }),
} as const;

/** The reordered ids, then every mod the caller did not name, in cache order. */
function fullOrder(reordered: string[], all: InstalledMod[] | undefined): string[] {
  if (!all) return reordered;
  const named = new Set(reordered);
  return [...reordered, ...all.filter((mod) => !named.has(mod.id)).map((mod) => mod.id)];
}
