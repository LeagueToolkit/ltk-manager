import { queryOptions, useQuery } from "@tanstack/react-query";

import { api, type AppError } from "@/lib/tauri";
import { queryFnWithArgs } from "@/utils/query";

import { diagnosticsKeys } from "./keys";

/** Query options for one incident's report text, for a caller that fetches on demand. */
export function incidentReportOptions(id: string) {
  return queryOptions<string, AppError>({
    queryKey: diagnosticsKeys.incidentReport(id),
    queryFn: queryFnWithArgs(api.incidentReport, id),
    staleTime: Infinity,
  });
}

/**
 * The report text of one incident, built by the backend.
 *
 * Cached for good, because an incident is written once and the report is a
 * pure function of it.
 */
export function useIncidentReport(id: string | null | undefined) {
  return useQuery({ ...incidentReportOptions(id ?? ""), enabled: !!id });
}
