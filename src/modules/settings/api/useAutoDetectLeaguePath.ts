import { useMutation } from "@tanstack/react-query";

import { api, type AppError } from "@/lib/tauri";
import { queryFn } from "@/utils/query";

/**
 * Searches the usual install locations for League of Legends.
 *
 * Finding nothing resolves to `null` rather than rejecting.
 */
export function useAutoDetectLeaguePath() {
  return useMutation<string | null, AppError, void>({
    mutationFn: queryFn(api.autoDetectLeaguePath),
  });
}
