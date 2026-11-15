import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import {
  api,
  type AppError,
  type PanicRecord,
  type ReportPreview,
  type ReportRequest,
} from "@/lib/tauri";
import { queryFn, queryFnWithArgs } from "@/utils/query";

import { supportKeys } from "./keys";

export const supportQueries = {
  /* Never cached past its request: the backend keeps the newest report only, and
     `save_support_report` refuses the id of an older one. */
  report: (request: ReportRequest) =>
    queryOptions<ReportPreview, AppError>({
      queryKey: supportKeys.report(request),
      queryFn: queryFnWithArgs(api.support.buildReport, request),
      placeholderData: keepPreviousData,
      staleTime: Infinity,
      gcTime: 0,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),

  /* The backend reads the record once at startup, so the answer changes only on a dismiss. */
  previousPanic: () =>
    queryOptions<PanicRecord | null, AppError>({
      queryKey: supportKeys.previousPanic(),
      queryFn: queryFn(api.support.previousPanic),
      staleTime: Infinity,
    }),
};
