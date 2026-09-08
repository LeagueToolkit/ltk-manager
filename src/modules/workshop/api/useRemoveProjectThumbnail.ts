import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type WorkshopProject } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

import { workshopKeys } from "./keys";

interface RemoveThumbnailArgs {
  projectPath: string;
}

/**
 * Hook to remove a project's thumbnail image.
 */
export function useRemoveProjectThumbnail() {
  const queryClient = useQueryClient();

  return useMutation<WorkshopProject, AppError, RemoveThumbnailArgs>({
    /* ThumbnailSection reports. */
    meta: { silentError: true },
    mutationFn: mutationFn(({ projectPath }) => api.removeProjectThumbnail(projectPath)),
    onSuccess: (updatedProject) => {
      queryClient.setQueryData<WorkshopProject[]>(workshopKeys.projects(), (old) =>
        old?.map((p) => (p.path === updatedProject.path ? updatedProject : p)),
      );
      queryClient.setQueryData(workshopKeys.project(updatedProject.path), updatedProject);

      queryClient.removeQueries({
        queryKey: workshopKeys.thumbnail(updatedProject.path, ""),
        exact: false,
      });
    },
  });
}
