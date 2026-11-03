import { useMutation, useQueryClient } from "@tanstack/react-query";

import { modOrderMutations } from "./modOrderMutations";
import { useClearedKeptSortToast } from "./useClearedKeptSortToast";

/** Move one mod into a folder. */
export function useMoveModToFolder() {
  return useMutation(modOrderMutations.moveToFolder(useQueryClient()));
}

/** Reorder the mods inside one folder. A changed order stops the folder keeping its sort. */
export function useReorderFolderMods() {
  const reportCleared = useClearedKeptSortToast();

  return useMutation({
    ...modOrderMutations.reorderInFolder(useQueryClient()),
    onSuccess: reportCleared,
  });
}

/** Reorder the folders themselves. */
export function useReorderFolders() {
  return useMutation(modOrderMutations.reorderFolders(useQueryClient()));
}
