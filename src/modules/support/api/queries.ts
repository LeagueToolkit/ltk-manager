import { keepPreviousData, queryOptions } from "@tanstack/react-query";

import {
  api,
  type AppError,
  type KnownIssue,
  type PanicRecord,
  type ReportPreview,
  type ReportRequest,
} from "@/lib/tauri";
import { queryFn, queryFnWithArgs } from "@/utils/query";

import { supportKeys } from "./keys";

/** The time for which an answer of the known issues feed is fresh, in milliseconds. */
const KNOWN_ISSUES_STALE_MS = 30 * 60 * 1000;

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

  knownIssues: () =>
    queryOptions<KnownIssue[], AppError>({
      queryKey: supportKeys.knownIssues(),
      queryFn: queryFn(api.support.listKnownIssues),
      staleTime: KNOWN_ISSUES_STALE_MS,
      retry: 1,
    }),
};
