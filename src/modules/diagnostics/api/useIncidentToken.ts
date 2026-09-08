import { useQuery } from "@tanstack/react-query";

import { diagnosticsQueries } from "./queries";

/** The incident folded into one short string, as `Copy token` and the bug report URL carry it. */
export function useIncidentToken(id: string | null | undefined) {
  return useQuery({ ...diagnosticsQueries.incidentToken(id ?? ""), enabled: !!id });
}
