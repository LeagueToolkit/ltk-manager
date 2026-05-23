import { useQuery } from "@tanstack/react-query";

import { api, type AppError, type DiagnosticReport } from "@/lib/tauri";
import { queryFn } from "@/utils/query";

import { diagnosticsKeys } from "./keys";

/**
 * Fetch the diagnostic report. Auto-fires on mount (the page is the only
 * caller) and is otherwise stable — `staleTime: Infinity` means TanStack
 * won't background-refetch on focus or reconnect; the user re-runs explicitly
 * via `query.refetch()` from the Re-run button.
 */
export function useDiagnostics() {
  return useQuery<DiagnosticReport, AppError>({
    queryKey: diagnosticsKeys.report(),
    queryFn: queryFn(api.runDiagnostics),
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}
