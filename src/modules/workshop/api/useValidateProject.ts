import { useQuery } from "@tanstack/react-query";

import { projectQueries } from "./queries";

/** A project checked against everything packing requires of it. */
export function useValidateProject(projectPath: string, enabled = true) {
  return useQuery(projectQueries.validation(enabled ? projectPath : undefined));
}
