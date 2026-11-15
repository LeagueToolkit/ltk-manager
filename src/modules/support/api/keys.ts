import type { ReportRequest } from "@/lib/tauri";

export const supportKeys = {
  all: ["support"] as const,
  report: (request: ReportRequest) => [...supportKeys.all, "report", request] as const,
  previousPanic: () => [...supportKeys.all, "previousPanic"] as const,
};
