import { queryOptions, skipToken, useQuery } from "@tanstack/react-query";

import { api, type AppError, type ContentTree } from "@/lib/tauri";
import { queryFnWithArgs } from "@/utils/query";

import { workshopKeys } from "./keys";

/**
 * How long a scan stays fresh, in milliseconds.
 *
 * The backend answers this query by walking every layer of the project and
 * returning every file, with no truncation. At `staleTime: 0` each focus of the
 * window paid for that walk again, so alternating with an external editor
 * re-scanned the whole project on every trip back.
 *
 * A window is the wrong instrument for this and a watch on the content
 * directory is the right one. Until then this bounds the cost to one walk per
 * interval while a save in another application still lands within it.
 */
const CONTENT_SCAN_STALE_MS = 10_000;

export function projectContentTreeOptions(projectPath: string | undefined) {
  return queryOptions<ContentTree, AppError>({
    queryKey: workshopKeys.contentTree(projectPath ?? ""),
    queryFn: projectPath ? queryFnWithArgs(api.getProjectContentTree, projectPath) : skipToken,
    refetchOnWindowFocus: true,
    staleTime: CONTENT_SCAN_STALE_MS,
  });
}

/**
 * Hook to fetch a project's content directory as a per-layer file listing.
 *
 * Refetches on window focus so external edits to the content directory surface
 * without a manual refresh, throttled by `CONTENT_SCAN_STALE_MS`. Every
 * mutation that writes into a layer invalidates the key directly, so a change
 * made in the app never waits for that interval.
 */
export function useProjectContentTree(projectPath: string | undefined) {
  return useQuery(projectContentTreeOptions(projectPath));
}
