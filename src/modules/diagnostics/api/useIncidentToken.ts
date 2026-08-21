import { queryOptions, useQuery } from "@tanstack/react-query";

import { api, type AppError } from "@/lib/tauri";
import { queryFnWithArgs } from "@/utils/query";

import { diagnosticsKeys } from "./keys";

/** Query options for one incident's token, for a caller that fetches on demand. */
export function incidentTokenOptions(id: string) {
  return queryOptions<string, AppError>({
    queryKey: diagnosticsKeys.incidentToken(id),
    queryFn: queryFnWithArgs(api.incidentToken, id),
    staleTime: Infinity,
  });
}

/** The incident folded into one short string, as `Copy token` and the bug report URL carry it. */
export function useIncidentToken(id: string | null | undefined) {
  return useQuery({ ...incidentTokenOptions(id ?? ""), enabled: !!id });
}
