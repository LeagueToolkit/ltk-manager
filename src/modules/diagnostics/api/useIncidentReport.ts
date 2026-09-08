import { useQuery } from "@tanstack/react-query";

import { diagnosticsQueries, type ReportSubject } from "./queries";

export type { ReportSubject } from "./queries";

/** The report text of one incident, built by the backend. */
export function useIncidentReport(incident: ReportSubject) {
  return useQuery(diagnosticsQueries.incidentReport(incident));
}
