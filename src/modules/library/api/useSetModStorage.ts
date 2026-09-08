import { useMutation, useQueryClient } from "@tanstack/react-query";

import { modMutations } from "./modMutations";

export type { SetModStorageVariables } from "./modMutations";

/** Switch where one mod's content is read from: its archive, or an unpacked tree. */
export function useSetModStorage() {
  return useMutation(modMutations.setStorage(useQueryClient()));
}
