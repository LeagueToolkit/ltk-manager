import { useMutation } from "@tanstack/react-query";

import { api, type AppError } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

/** Reveals an incident's `r3dlog` in the file manager. Fails for an incident with no log. */
export function useRevealGameLog() {
  return useMutation<null, AppError, string>({
    /* IncidentDetail reports. */
    meta: { silentError: true },
    mutationFn: mutationFn(api.diagnostics.revealGameLog),
  });
}
