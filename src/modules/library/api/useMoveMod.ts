import { useMutation, useQueryClient } from "@tanstack/react-query";

import { modOrderMutations } from "./modOrderMutations";

/** Move one mod into a folder. */
export function useMoveModToFolder() {
  return useMutation(modOrderMutations.moveToFolder(useQueryClient()));
}

/** Reorder the mods inside one folder. */
export function useReorderFolderMods() {
  return useMutation(modOrderMutations.reorderInFolder(useQueryClient()));
}

/** Reorder the folders themselves. */
export function useReorderFolders() {
  return useMutation(modOrderMutations.reorderFolders(useQueryClient()));
}
