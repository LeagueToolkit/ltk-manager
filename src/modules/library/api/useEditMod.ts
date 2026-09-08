import { useMutation, useQueryClient } from "@tanstack/react-query";

import { modMutations } from "./modMutations";

export type { EditModVariables } from "./modMutations";

/** Edit a mod's metadata, answering the updated mod. */
export function useEditMod() {
  return useMutation(modMutations.edit(useQueryClient()));
}
