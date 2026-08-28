import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useToast } from "@/components";
import { api, type AppError, type LibraryRepairReport, type ModRepairProgress } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { hasErrorCode } from "@/utils/errors";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";

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
      const repaired = `${report.repaired.length} mod${report.repaired.length === 1 ? "" : "s"}`;

      if (report.failed.length > 0) {
        const failed = `${report.failed.length} could not be repaired`;
        toast.warning("Repaired what we could", `${repaired} repaired, and ${failed}.`);
        return;
      }
      if (report.repaired.length === 0) {
        toast.info("Nothing to repair", "Your mods were already up to date.");
        return;
      }
      toast.success(`Repaired ${repaired}`, "They are ready for your next game.");
    },
    onError: (error) => {
      if (hasErrorCode(error, "PATCHER")) {
        toast.error("Stop the patcher first", "A repair rewrites mods the overlay is reading.");
        return;
      }
      toast.error(error.message ?? "Failed to repair mods");
    },
  });

  return { repair: run.mutate, isRepairing: run.isPending, progress };
}
