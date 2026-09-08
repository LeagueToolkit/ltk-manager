import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { match } from "ts-pattern";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, type AppError, type LibraryRepairReport, type ModRepairProgress } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "../keys";

/** A library-wide repair, and how far along it is. */
export interface RepairRun {
  /** Repair every mod named, in the order given. */
  repair: (modIds: string[]) => void;
  /** Whether a repair is running, including before its first mod is reported. */
  isRepairing: boolean;
  /** The mod the run is on, or null while nothing is running. */
  progress: ModRepairProgress | null;
}

/**
 * Repair every mod named, and say what became of them.
 *
 * **Mount this once.** It listens for the backend's progress on top of holding
 * the mutation, and a second holder would subscribe again - the run would be
 * reported twice over. A surface that only needs to start one takes the action
 * from whoever mounted this.
 *
 * The progress is returned rather than narrated, so the surface that owns the
 * run draws it where the run is happening. The outcome stays a toast: by then
 * the surface it belongs to has usually emptied itself and gone.
 *
 * The backend records each mod's fresh verdict as it goes, so the badges follow
 * from refetching the verdicts rather than from anything this reports.
 */
export function useRepairMods(): RepairRun {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [progress, setProgress] = useState<ModRepairProgress | null>(null);

  useTauriEvent<ModRepairProgress>("mod-repair-progress", setProgress);

  const run = useMutation<LibraryRepairReport, AppError, string[]>({
    meta: { silentError: true },
    mutationFn: async (modIds) => {
      const result = await api.repairMods(modIds);
      return unwrapForQuery(result);
    },
    onMutate: () => setProgress(null),
    onSettled: () => {
      setProgress(null);
      void queryClient.invalidateQueries({ queryKey: libraryKeys.modHealthVerdicts() });
      void queryClient.invalidateQueries({ queryKey: libraryKeys.wadReports() });
    },
    onSuccess: (report) => {
      if (report.failed.length > 0) {
        toast.warning(
          m.library_health_repair_partial_title(),
          m.library_health_repair_partial_hint({
            repaired: report.repaired.length,
            failed: report.failed.length,
          }),
        );
        return;
      }
      if (report.repaired.length === 0) {
        toast.info(
          m.library_health_nothing_to_repair_title(),
          m.library_health_nothing_to_repair_hint(),
        );
        return;
      }
      toast.success(
        m.library_health_repaired_title({ count: report.repaired.length }),
        m.library_health_repaired_hint(),
      );
    },
    onError: (error) =>
      match(error)
        .with({ code: "PATCHER" }, () =>
          toast.error(
            m.library_health_patcher_running_title(),
            m.library_health_patcher_running_hint(),
          ),
        )
        .otherwise(() =>
          toast.error(m.library_health_repair_library_failed_title(), errorSummary(error)),
        ),
  });

  return { repair: run.mutate, isRepairing: run.isPending, progress };
}
