import { useMutation, useQueryClient } from "@tanstack/react-query";
import { match } from "ts-pattern";

import { useToast } from "@/components";
import { errorSummary, m } from "@/i18n";
import { api, type AppError, type ModHealthVerdict } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "../keys";

/**
 * Re-check one mod's health on demand and refresh its remembered verdict.
 */
export function useCheckModHealth() {
  const queryClient = useQueryClient();
  const toast = useToast();

  return useMutation<ModHealthVerdict, AppError, string>({
    meta: { silentError: true },
    mutationFn: async (modId) => {
      const result = await api.checkModHealth(modId);
      return unwrapForQuery(result);
    },
    onSuccess: (verdict) => {
      // Patch the shared batch cache so the badge updates immediately.
      queryClient.setQueryData<Record<string, ModHealthVerdict>>(
        libraryKeys.modHealthVerdicts(),
        (old) => (old ? { ...old, [verdict.modId]: verdict } : { [verdict.modId]: verdict }),
      );
    },
    onError: (error) =>
      match(error)
        .with({ code: "MOD_NOT_FOUND" }, () => toast.error(m.library_mod_missing_title()))
        .otherwise(() =>
          toast.error(m.library_health_check_mod_failed_title(), errorSummary(error)),
        ),
  });
}
