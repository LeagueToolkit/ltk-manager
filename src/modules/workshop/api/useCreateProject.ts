import { useMutation, useQueryClient } from "@tanstack/react-query";

import { projectMutations } from "./mutations";

/** Create a new workshop project. */
export function useCreateProject() {
  return useMutation(projectMutations.create(useQueryClient()));
}
