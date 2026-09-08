import { useMutation, useQueryClient } from "@tanstack/react-query";

import { settingsMutations } from "./mutations";

/** Save the app settings. */
export function useSaveSettings() {
  return useMutation(settingsMutations.save(useQueryClient()));
}
