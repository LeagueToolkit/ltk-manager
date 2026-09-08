import { useMutation, useQueryClient } from "@tanstack/react-query";

import { layerMutations } from "./mutations";

export type { ReorderLayersVariables } from "./mutations";

/** Reorder a project's layers, optimistically. */
export function useReorderLayers() {
  return useMutation(layerMutations.reorder(useQueryClient()));
}
