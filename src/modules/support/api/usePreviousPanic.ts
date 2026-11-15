import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type AppError } from "@/lib/tauri";
import { mutationFn } from "@/utils/query";

import { supportKeys } from "./keys";
import { supportQueries } from "./queries";

/**
 * Returns the panic that closed the run before this one.
 *
 * The data is `null` if that run exited normally, or after the user dismisses the panic.
 */
export function usePreviousPanic() {
  return useQuery(supportQueries.previousPanic());
}

/** Forgets the panic that closed the run before this one, so that no surface shows it again. */
export function useDismissPreviousPanic() {
  const queryClient = useQueryClient();

  return useMutation<null, AppError, void>({
    mutationFn: mutationFn(api.support.dismissPreviousPanic),
    onSuccess: () => queryClient.setQueryData(supportKeys.previousPanic(), null),
  });
}
