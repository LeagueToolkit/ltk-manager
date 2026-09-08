import { useMutation } from "@tanstack/react-query";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, type AppError, type HealthSweepReport } from "@/lib/tauri";
import { useModHealthDrawerStore } from "@/stores";
import { unwrapForQuery } from "@/utils/query";

/**
 * Re-check a selection of mods, or the whole library where none are named.
 *
 * The run reports through the sweep's own progress toast and refreshes the
 * verdicts as it finishes, so what is left here is the answer a press is owed.
 * A library with something wrong is announced by the drawer rather than from
 * here, which is why the press forgets what the reader was last told.
 */
export function useSweepModHealth() {
  const toast = useToast();
  const forgetAnnouncement = useModHealthDrawerStore((s) => s.forgetAnnouncement);

  return useMutation<HealthSweepReport, AppError, string[] | undefined>({
    meta: { silentError: true },
    mutationFn: async (modIds) => unwrapForQuery(await api.sweepModHealth(modIds)),
    onSuccess: (report) => {
      forgetAnnouncement();
      if (report.repairable.length + report.unrepairable.length > 0) return;
      toast.success(
        m.library_health_check_clean_title(),
        m.library_health_check_clean_hint({ count: report.checked }),
      );
    },
    onError: (error) =>
      toast.error(m.library_health_check_library_failed_title(), errorSummary(error)),
  });
}
