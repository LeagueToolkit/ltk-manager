import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type WorkshopProject } from "@/lib/tauri";
import { useWorkshopEditorStore } from "@/stores";
import { unwrapForQuery } from "@/utils/query";

import { workshopKeys } from "./keys";

/**
 * Hook to delete a workshop project.
 */
export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation<void, AppError, string>({
    mutationFn: async (projectPath) => {
      const result = await api.deleteWorkshopProject(projectPath);
      return unwrapForQuery(result);
    },
    onSuccess: (_, projectPath) => {
      // Remove the project from the cache
      queryClient.setQueryData<WorkshopProject[]>(workshopKeys.projects(), (old) =>
        old?.filter((p) => p.path !== projectPath),
      );
      // Invalidate the individual project cache
      queryClient.removeQueries({ queryKey: workshopKeys.project(projectPath) });

      /* The editor persists its strip under the project path, and a deleted
         project never comes back to claim it. */
      useWorkshopEditorStore.getState().forgetProject(projectPath);
    },
  });
}
