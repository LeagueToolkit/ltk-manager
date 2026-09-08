import { useMutation } from "@tanstack/react-query";

import { useToast } from "@/components";
import { errorSummary } from "@/i18n";
import { api, type AppError } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

/**
 * Ask the Riot Client to close the game it launched.
 *
 * Only offered while a session is live: the client refuses to close a product
 * it never started, and it is the one that knows what that is. Success means
 * the request was taken, and the game follows within a few seconds - the
 * session ending is what returns the bar to rest.
 */
export function useStopLeague() {
  const toast = useToast();

  return useMutation<void, AppError, void>({
    meta: { silentError: true },
    mutationFn: async () => {
      const result = await api.stopLeague();
      return unwrapForQuery(result);
    },
    onError: (error) => {
      toast.error("Couldn't close League", errorSummary(error));
      console.error("Failed to close League:", error);
    },
  });
}
