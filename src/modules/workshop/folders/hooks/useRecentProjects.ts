import { useMemo } from "react";

import type { WorkshopProject } from "@/lib/tauri";

import { useWorkshopProjects } from "../../projects/api/useWorkshopProjects";

/** The projects opened most recently, newest first, at most `limit` of them. */
export function useRecentProjects(limit: number): readonly WorkshopProject[] {
  const { data: projects } = useWorkshopProjects();

  return useMemo(
    () =>
      (projects ?? [])
        .filter((project) => project.lastOpened !== null)
        .sort((a, b) => Date.parse(b.lastOpened ?? "") - Date.parse(a.lastOpened ?? ""))
        .slice(0, limit),
    [limit, projects],
  );
}
