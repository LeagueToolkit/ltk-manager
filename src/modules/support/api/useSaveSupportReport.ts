import { useMutation } from "@tanstack/react-query";

import { m } from "@/i18n";
import { api, type AppError } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

interface SaveRequest {
  /** The id of the report that the dialog shows. */
  id: string;
  /** The path of the zip, or `null` for the Downloads folder. */
  destination: string | null;
}

/** Writes a built support report as a zip and reveals it. Resolves to the path of the zip. */
export function useSaveSupportReport() {
  return useMutation<string, AppError, SaveRequest>({
    meta: { errorTitle: m.support_save_failed_title() },
    mutationFn: mutationFn(({ id, destination }) => api.support.saveReport(id, destination)),
  });
}
