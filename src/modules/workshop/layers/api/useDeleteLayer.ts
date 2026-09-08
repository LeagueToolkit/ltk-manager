import { useMutation, useQueryClient } from "@tanstack/react-query";

import { layerMutations } from "./mutations";

export type { DeleteLayerVariables } from "./mutations";

/** Remove a layer from a project. */
export function useDeleteLayer() {
  return useMutation(layerMutations.remove(useQueryClient()));
}
