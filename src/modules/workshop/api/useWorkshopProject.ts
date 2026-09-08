import { useQuery } from "@tanstack/react-query";

import { projectQueries } from "./queries";

/** One workshop project by path. */
export function useWorkshopProject(projectPath: string) {
  return useQuery(projectQueries.byPath(projectPath));
}
