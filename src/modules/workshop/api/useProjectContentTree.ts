import { useQuery } from "@tanstack/react-query";

import { projectQueries } from "./queries";

/** A project's content directory as a per-layer file listing. */
export function useProjectContentTree(projectPath: string | undefined) {
  return useQuery(projectQueries.contentTree(projectPath));
}
