import { useMutation, useQueryClient } from "@tanstack/react-query";

import { projectMutations } from "./mutations";

export type { RenameProjectVariables } from "./mutations";

/** Rename a workshop project, which moves its directory. */
export function useRenameProject() {
  return useMutation(projectMutations.rename(useQueryClient()));
}
