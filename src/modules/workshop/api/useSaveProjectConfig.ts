import { useMutation, useQueryClient } from "@tanstack/react-query";

import { projectMutations } from "./mutations";

/** Save a project's configuration. */
export function useSaveProjectConfig() {
  return useMutation(projectMutations.saveConfig(useQueryClient()));
}
