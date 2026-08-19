import { useMemo } from "react";

import { usePatcherStatus } from "@/modules/patcher";
import { usePatcherSessionStore } from "@/stores";

import { useWorkshopProjects } from "./useWorkshopProjects";

/**
 * Display names for the workshop projects the session in flight covers.
 *
 * Empty while nothing is running, and while the session came from the library.
 *
 * The session carries paths, since a display name is the frontend's business,
 * so these are resolved against the project list - a path it has not caught up
 * with falls back to its directory name. Before the first status poll lands
 * there is no session yet, and the store's optimistic list stands in.
 */
export function useSessionProjectNames(): string[] {
  const { data: status } = usePatcherStatus();
  const { data: allProjects } = useWorkshopProjects();
  const testingProjects = usePatcherSessionStore((s) => s.testingProjects);

  return useMemo(() => {
    const session = status?.session ?? null;
    if (!session) return testingProjects.map((p) => p.displayName);
    if (session.origin.kind !== "workshop") return [];

    return session.origin.projects.map((path) => {
      const match = allProjects?.find((p) => p.path === path);
      if (match) return match.displayName;
      return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
    });
  }, [status, allProjects, testingProjects]);
}
