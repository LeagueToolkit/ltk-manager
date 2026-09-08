import { useMutation, useQueryClient } from "@tanstack/react-query";

import { modMutations } from "./modMutations";

/** Enable a mod and set its layers in one write, optimistically. */
export function useEnableModWithLayers() {
  return useMutation(modMutations.enableWithLayers(useQueryClient()));
}
