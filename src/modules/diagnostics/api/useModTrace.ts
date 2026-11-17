import { useQuery } from "@tanstack/react-query";

import type { TraceSubject } from "@/lib/tauri";

import { diagnosticsQueries } from "./queries";

/** Why the mod or the project `subject` did or did not reach the last game. */
export function useModTrace(subject: TraceSubject) {
  return useQuery(diagnosticsQueries.trace(subject));
}
