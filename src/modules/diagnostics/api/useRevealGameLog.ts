import { useMutation } from "@tanstack/react-query";

import { api, type AppError } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

/** Reveals an incident's `r3dlog` in the file manager. Fails for an incident with no log. */
export function useRevealGameLog() {
  return useMutation<void, AppError, string>({
    mutationFn: mutationFn(api.revealGameLog),
  });
}
