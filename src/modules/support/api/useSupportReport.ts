import { useQuery } from "@tanstack/react-query";

import type { ReportRequest } from "@/lib/tauri";

import { supportQueries } from "./queries";

/**
 * Builds the support report for `request` and returns it as the dialog shows it.
 *
 * A change of `request` builds the report again, and the last report stays as the data until
 * the new one lands.
 */
export function useSupportReport(request: ReportRequest) {
  return useQuery(supportQueries.report(request));
}
