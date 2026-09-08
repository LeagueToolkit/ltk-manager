import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components";
import { errorSummary } from "@/i18n";
import { api, type AppError } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { workshopKeys } from "./keys";

interface DeleteLayerContentArgs {
  projectPath: string;
  layerName: string;
  /** Layer-relative, the way the content listing names its entries. */
  relativePath: string;
  /** What the toast calls it, which is the row's own label rather than its path. */
  name: string;
}

/**
 * Delete one file or directory out of a layer's content directory.
 *
 * A directory goes with everything below it, and the directories the delete
 * empties go with it, so a layer never keeps an archive the tree shows as gone.
 * Nothing here is reversible - the confirmation is the caller's to hold.
 */
export function useDeleteLayerContent() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation<void, AppError, DeleteLayerContentArgs>({
    meta: { silentError: true },
    mutationFn: async ({ projectPath, layerName, relativePath }) => {
      const result = await api.deleteLayerContent(projectPath, layerName, relativePath);
      return unwrapForQuery(result);
    },
    onSuccess: (_result, { projectPath, name }) => {
      queryClient.invalidateQueries({ queryKey: workshopKeys.contentTree(projectPath) });
      toast.success(`Deleted ${name}`);
    },
    onError: (error) => {
      toast.error("Couldn't delete", errorSummary(error));
    },
  });
}
