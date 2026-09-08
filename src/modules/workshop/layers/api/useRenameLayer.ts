import { useMutation, useQueryClient } from "@tanstack/react-query";

import { layerMutations } from "./mutations";

export type { RenameLayerVariables } from "./mutations";

/** Change a layer's display name. */
export function useRenameLayer() {
  return useMutation(layerMutations.rename(useQueryClient()));
}
