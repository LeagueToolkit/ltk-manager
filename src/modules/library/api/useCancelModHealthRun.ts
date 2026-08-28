import { useMutation } from "@tanstack/react-query";

import { useToast } from "@/components";
import { api, type AppError } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

/**
 * Call off the check or repair the backend is running.
 *
 * Every worker stops at its next file. A mod already written stays written -
 * this stops the run rather than undoing it - and a mod the run had started but
 * not finished forgets its verdict, so the next sweep owes it a check.
 *
 * Nothing is announced on success: the run's own progress ending is what the
 * reader is watching, and a toast over it would report what they can already
 * see.
 */
export function useCancelModHealthRun() {
  const toast = useToast();

  return useMutation<null, AppError, void>({
    mutationFn: async () => unwrapForQuery(await api.cancelModHealthRun()),
    onError: (error) => {
      toast.error("Couldn't stop the run", error.message);
    },
  });
}
