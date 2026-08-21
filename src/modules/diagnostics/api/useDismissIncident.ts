import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type Incident } from "@/lib/tauri";
import { useIncidentLineStore } from "@/stores";
import { unwrapForQuery } from "@/utils/query";

import { diagnosticsKeys } from "./keys";

/**
 * Marks an incident dismissed. Optimistic, because the flag is the user's own
 * statement and the backend has no reason to disagree.
 */
export function useDismissIncident() {
  const queryClient = useQueryClient();
  const clearLine = useIncidentLineStore((s) => s.clear);

  return useMutation<void, AppError, string, { previous?: Incident[] }>({
    mutationFn: async (id) => unwrapForQuery(await api.dismissIncident(id)),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: diagnosticsKeys.incidents() });
      const previous = queryClient.getQueryData<Incident[]>(diagnosticsKeys.incidents());
      queryClient.setQueryData<Incident[]>(diagnosticsKeys.incidents(), (old) =>
        old?.map((incident) => (incident.id === id ? { ...incident, dismissed: true } : incident)),
      );
      clearLine(id);
      return { previous };
    },
    onError: (_error, _id, context) => {
      if (context?.previous) {
        queryClient.setQueryData(diagnosticsKeys.incidents(), context.previous);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: diagnosticsKeys.incidents() });
    },
  });
}
