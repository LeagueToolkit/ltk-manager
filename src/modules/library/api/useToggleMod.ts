import { useMutation, useQueryClient } from "@tanstack/react-query";

import { modMutations } from "./modMutations";

export type { ToggleModVariables } from "./modMutations";

/** Toggle a mod's enabled state, optimistically. */
export function useToggleMod() {
  return useMutation(modMutations.toggle(useQueryClient()));
}
