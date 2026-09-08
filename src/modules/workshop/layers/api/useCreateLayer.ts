import { useMutation, useQueryClient } from "@tanstack/react-query";

import { layerMutations } from "./mutations";

export type { CreateLayerVariables } from "./mutations";

/** Add a layer to a project. */
export function useCreateLayer() {
  return useMutation(layerMutations.create(useQueryClient()));
}
