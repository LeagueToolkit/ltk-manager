import type { TraceSubject } from "@/lib/tauri";

export const diagnosticsKeys = {
  all: ["diagnostics"] as const,
  report: () => [...diagnosticsKeys.all, "report"] as const,
  incidents: () => [...diagnosticsKeys.all, "incidents"] as const,
  incidentReport: (id: string) => [...diagnosticsKeys.incidents(), id, "report"] as const,
  incidentToken: (id: string) => [...diagnosticsKeys.incidents(), id, "token"] as const,
  advisories: () => [...diagnosticsKeys.all, "advisories"] as const,
  traces: () => [...diagnosticsKeys.all, "trace"] as const,
  trace: (subject: TraceSubject) => [...diagnosticsKeys.traces(), subject] as const,
};
