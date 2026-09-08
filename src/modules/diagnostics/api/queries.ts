import { queryOptions } from "@tanstack/react-query";

import { api, type AppError, type DiagnosticReport, type Incident } from "@/lib/tauri";
import { queryFn, queryFnWithArgs } from "@/utils/query";

import { hintTexts } from "../utils/hints";
import { diagnosticsKeys } from "./keys";

/** What one report is built from: the incident, and its hints as the catalog reads them. */
export type ReportSubject = Pick<Incident, "id" | "verdict" | "redirected">;

/** The diagnostic report, and the incidents the store remembers. */
export const diagnosticsQueries = {
  /* Stable once it lands: no background refetch on a focus or a reconnect, and the
     Re-run button is how a user asks for a newer one. */
  report: () =>
    queryOptions<DiagnosticReport, AppError>({
      queryKey: diagnosticsKeys.report(),
      queryFn: queryFn(api.diagnostics.run),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
      gcTime: Infinity,
    }),

  /* Stable until `incident-recorded` or a dismiss invalidates it, because the
     backend is the only writer and it announces every write. */
  incidents: () =>
    queryOptions<Incident[], AppError>({
      queryKey: diagnosticsKeys.incidents(),
      queryFn: queryFn(api.diagnostics.listIncidents),
      staleTime: Infinity,
    }),

  /* Cached for good, because an incident is written once and the report is a pure
     function of it. The hints ride along as sentences. The catalog owns those, and
     the backend holds the codes alone. */
  incidentReport: (incident: ReportSubject) =>
    queryOptions<string, AppError>({
      queryKey: diagnosticsKeys.incidentReport(incident.id),
      queryFn: queryFnWithArgs(api.diagnostics.incidentReport, incident.id, hintTexts(incident)),
      staleTime: Infinity,
    }),

  incidentToken: (id: string) =>
    queryOptions<string, AppError>({
      queryKey: diagnosticsKeys.incidentToken(id),
      queryFn: queryFnWithArgs(api.diagnostics.incidentToken, id),
      staleTime: Infinity,
    }),
} as const;
