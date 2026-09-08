import { useMutation, useQueryClient } from "@tanstack/react-query";

import { layerMutations } from "./mutations";

export type { UpdateLayerDescriptionVariables } from "./mutations";

/** Change a layer's description. */
export function useUpdateLayerDescription() {
  return useMutation(layerMutations.describe(useQueryClient()));
}
