import { useMutation, useQueryClient } from "@tanstack/react-query";

import { folderMutations } from "./folderMutations";

/** Create a library folder. */
export function useCreateFolder() {
  return useMutation(folderMutations.create(useQueryClient()));
}

/** Rename a library folder, optimistically. */
export function useRenameFolder() {
  return useMutation(folderMutations.rename(useQueryClient()));
}

/** Delete a library folder, releasing the mods it held. */
export function useDeleteFolder() {
  return useMutation(folderMutations.remove(useQueryClient()));
}

/** Enable or disable every mod a folder holds. */
export function useToggleFolder() {
  return useMutation(folderMutations.toggle(useQueryClient()));
}
