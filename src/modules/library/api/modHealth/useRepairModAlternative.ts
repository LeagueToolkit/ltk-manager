import { useMutation, useQueryClient } from "@tanstack/react-query";
import { match } from "ts-pattern";

import { useToast } from "@/components/Toast";
import { m } from "@/i18n";
import { api, type AppError, type FixReport } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "../keys";

/** One alternative of one finding in one mod, as the drawer's press names it. */
export interface RepairAlternativeArgs {
  modId: string;
  problem: string;
  alternative: string;
}

/**
 * Applies one alternative of one finding in one mod.
 *
 * The explicit press beside a finding, which "Repair" and "Repair all" never make. The
 * caches it refreshes are the ones `useRepairMod` refreshes.
 */
export function useRepairModAlternative() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation<FixReport, AppError, RepairAlternativeArgs>({
    meta: { silentError: true },
    mutationFn: async ({ modId, problem, alternative }) => {
      const result = await api.repairModAlternative(modId, problem, alternative);
      return unwrapForQuery(result);
    },
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey: libraryKeys.modHealthVerdicts() });
      if (report.applied > 0) {
        void queryClient.invalidateQueries({ queryKey: libraryKeys.wadReports() });
        toast.success(m.library_health_alternative_applied_title());
      } else {
        toast.info(m.library_health_alternative_skipped_title());
      }
    },
    onError: (error) =>
      match(error)
        .with({ code: "MOD_NOT_FOUND" }, () => toast.error(m.library_mod_missing_title()))
        .otherwise(() => toast.failure(m.library_health_alternative_failed_title(), error)),
  });
}
