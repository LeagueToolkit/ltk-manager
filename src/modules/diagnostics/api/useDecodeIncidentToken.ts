import { useMutation } from "@tanstack/react-query";

import { api, type AppError, type IncidentToken } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

/**
 * Unfolds a pasted token into the record it carries.
 *
 * The backend accepts a bare token, or a report or URL with one inside, so
 * the caller passes the paste through untouched.
 */
export function useDecodeIncidentToken() {
  return useMutation<IncidentToken, AppError, string>({
    mutationFn: mutationFn(api.decodeIncidentToken),
  });
}
