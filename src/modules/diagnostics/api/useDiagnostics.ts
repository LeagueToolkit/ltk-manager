import { useQuery } from "@tanstack/react-query";

import { diagnosticsQueries } from "./queries";

/** The diagnostic report, run once on mount and re-run only when asked. */
export function useDiagnostics() {
  return useQuery(diagnosticsQueries.report());
}
