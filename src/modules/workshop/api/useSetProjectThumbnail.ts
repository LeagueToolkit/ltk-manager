import { useMutation, useQueryClient } from "@tanstack/react-query";
import { convertFileSrc } from "@tauri-apps/api/core";

import { api, type AppError, type WorkshopProject } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

import { workshopKeys } from "./keys";

interface SetThumbnailArgs {
  projectPath: string;
  imagePath: string;
}

/**
 * Hook to set a project's thumbnail image.
 */
export function useSetProjectThumbnail() {
  const queryClient = useQueryClient();

  return useMutation<WorkshopProject, AppError, SetThumbnailArgs>({
    /* ThumbnailSection and NewProjectDialog report. */
    meta: { silentError: true },
    mutationFn: mutationFn(({ projectPath, imagePath }) =>
      api.setProjectThumbnail(projectPath, imagePath),
    ),
    onSuccess: (updatedProject) => {
      // Update project data in cache
      queryClient.setQueryData<WorkshopProject[]>(workshopKeys.projects(), (old) =>
        old?.map((p) => (p.path === updatedProject.path ? updatedProject : p)),
      );
      queryClient.setQueryData(workshopKeys.project(updatedProject.path), updatedProject);

      // Directly set a cache-busted asset URL into the thumbnail query.
      // The backend file path doesn't change (always thumbnail.webp), so
      // convertFileSrc returns the same URL and the webview serves the cached
      // image. Appending a timestamp forces the webview to fetch the new file.
      if (updatedProject.thumbnailPath) {
        const bustUrl = `${convertFileSrc(updatedProject.thumbnailPath)}?v=${Date.now()}`;
        queryClient.setQueryData(
          workshopKeys.thumbnail(updatedProject.path, updatedProject.thumbnailPath),
          bustUrl,
        );
      }
    },
  });
}
