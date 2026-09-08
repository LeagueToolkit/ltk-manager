import { useMutation, useQueryClient } from "@tanstack/react-query";

import { projectMutations } from "./mutations";

export type { SaveStringOverridesVariables } from "./mutations";

/** Save the string overrides of one layer. */
export function useSaveStringOverrides() {
  return useMutation(projectMutations.saveStringOverrides(useQueryClient()));
}
