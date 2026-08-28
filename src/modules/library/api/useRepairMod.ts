import { useMutation, useQueryClient } from "@tanstack/react-query";

import { useToast } from "@/components";
import { api, type AppError, type FixReport } from "@/lib/tauri";
import { hasErrorCode } from "@/utils/errors";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";

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
    mutationFn: async (modId) => {
      const result = await api.repairMod(modId);
      return unwrapForQuery(result);
    },
    onSuccess: (report) => {
      void queryClient.invalidateQueries({ queryKey: libraryKeys.modHealthVerdicts() });
      if (report.applied > 0) {
        void queryClient.invalidateQueries({ queryKey: libraryKeys.wadReports() });
        toast.success(`Repaired ${report.applied} finding${report.applied === 1 ? "" : "s"}`);
      } else {
        toast.info("Nothing to repair");
      }
    },
    onError: (error) => {
      if (hasErrorCode(error, "MOD_NOT_FOUND")) {
        toast.error("Mod no longer exists in the library");
        return;
      }
      toast.error(error.message ?? "Failed to repair mod");
    },
  });
}
