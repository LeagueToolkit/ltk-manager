import { useQuery } from "@tanstack/react-query";

import { projectQueries } from "./queries";

/** Every workshop project the configured directory holds. */
export function useWorkshopProjects() {
  return useQuery(projectQueries.all());
}
