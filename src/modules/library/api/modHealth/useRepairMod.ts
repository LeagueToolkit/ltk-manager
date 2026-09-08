import { useMutation, useQueryClient } from "@tanstack/react-query";
import { match } from "ts-pattern";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, type AppError, type FixReport } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "../keys";

/**
 * Repair what a machine can repair in one mod.
 *
 * The backend refreshes the mod's verdict itself, so on success the verdict
 * cache is refetched rather than patched. The WAD-report cache is invalidated
 * too, because a repair rewrote the content those fingerprints describe.
 */
export function useRepairMod() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation<FixReport, AppError, string>({
    meta: { silentError: true },
    mutationFn: async (modId) => {
      const result = await api.repairMod(modId);
      return unwrapForQuery(result);
    },
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey: libraryKeys.modHealthVerdicts() });
      if (report.applied > 0) {
        void queryClient.invalidateQueries({ queryKey: libraryKeys.wadReports() });
        toast.success(m.library_health_repaired_findings_title({ count: report.applied }));
      } else {
        toast.info(m.library_health_nothing_to_repair_title());
      }
    },
    onError: (error) =>
      match(error)
        .with({ code: "MOD_NOT_FOUND" }, () => toast.error(m.library_mod_missing_title()))
        .otherwise(() =>
          toast.error(m.library_health_repair_mod_failed_title(), errorSummary(error)),
        ),
  });
}
