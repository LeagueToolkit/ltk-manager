import { useMutation, useQueryClient } from "@tanstack/react-query";

import { projectMutations } from "./mutations";

export type { RemoveThumbnailVariables } from "./mutations";

/** Remove a project's thumbnail image. */
export function useRemoveProjectThumbnail() {
  return useMutation(projectMutations.removeThumbnail(useQueryClient()));
}
