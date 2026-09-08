import { useMutation, useQueryClient } from "@tanstack/react-query";

import { modMutations } from "./modMutations";

export type { SetModLayersVariables } from "./modMutations";

/** Switch which of a mod's layers are on, optimistically. */
export function useSetModLayers() {
  return useMutation(modMutations.setLayers(useQueryClient()));
}
