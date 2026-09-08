import { useQuery } from "@tanstack/react-query";

import { projectQueries } from "./queries";

/** A project thumbnail as a Tauri asset URL. */
export function useProjectThumbnail(projectPath: string, thumbnailPath?: string | null) {
  return useQuery(projectQueries.thumbnail(projectPath, thumbnailPath));
}
