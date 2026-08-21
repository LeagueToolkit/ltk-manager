import { useMutation } from "@tanstack/react-query";

import { api, type AppError, type DecodedIncident } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

/**
 * Unfolds a pasted token into the incident it carries, read against this
 * build's tables.
 *
 * The backend accepts a bare token, or a report or URL with one inside, so
 * the caller passes the paste through untouched. Its error is a sentence
 * meant to be shown as it is.
 */
export function useDecodeIncidentToken() {
  return useMutation<DecodedIncident, AppError, string>({
    mutationFn: mutationFn(api.decodeIncidentToken),
  });
}
