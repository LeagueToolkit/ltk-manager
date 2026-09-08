import { useMutation } from "@tanstack/react-query";

import { settingsMutations } from "./mutations";

/**
 * Search the usual install locations for League of Legends.
 *
 * Finding nothing resolves to `null` rather than rejecting.
 */
export function useAutoDetectLeaguePath() {
  return useMutation(settingsMutations.autoDetectLeaguePath());
}
