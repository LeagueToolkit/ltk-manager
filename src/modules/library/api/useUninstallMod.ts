import { useMutation, useQueryClient } from "@tanstack/react-query";

import { modMutations } from "./modMutations";

/** Uninstall a mod, optimistically. */
export function useUninstallMod() {
  return useMutation(modMutations.uninstall(useQueryClient()));
}
