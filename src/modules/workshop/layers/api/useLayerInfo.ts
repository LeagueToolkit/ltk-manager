import { useQuery } from "@tanstack/react-query";

import { projectQueries } from "../../api/queries";

/** What each named layer of a project holds. */
export function useLayerInfo(projectPath: string, layerNames: string[]) {
  return useQuery(projectQueries.layerInfo(projectPath, layerNames));
}
