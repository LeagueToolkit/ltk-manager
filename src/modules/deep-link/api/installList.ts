import { mutationOptions, type QueryClient, queryOptions } from "@tanstack/react-query";

import {
  api,
  type AppError,
  type InstallList,
  type InstallListPlan,
  type InstallListReport,
} from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "../../library/api/keys";
import { useInstallListStore } from "../state";

export const installListKeys = {
  all: ["deep-link", "install-list"] as const,
  manifest: (url: string) => [...installListKeys.all, "manifest", url] as const,
};

/** The list an `ltk://install-list` link names. */
export const installListQueries = {
  /* Read once per link: the URL is signed for minutes, so a refetch would fail where
     the first read did not, and a list is confirmed against the read the reader saw. */
  manifest: (url: string) =>
    queryOptions<InstallList, AppError>({
      queryKey: installListKeys.manifest(url),
      queryFn: async () => unwrapForQuery(await api.deepLinkInstallListFetch(url)),
      staleTime: Infinity,
      gcTime: 0,
      retry: false,
    }),
} as const;

/** The install a confirmed list asks for, and the stop. */
export const installListMutations = {
  install: (client: QueryClient) =>
    mutationOptions<InstallListReport, AppError, InstallListPlan>({
      /* The dialog draws the failure it puts in the store. */
      meta: { silentError: true },
      mutationFn: async (plan) => {
        useInstallListStore.getState().startRun();
        return unwrapForQuery(await api.deepLinkInstallList(plan));
      },
      onSuccess: (report) => {
        useInstallListStore.getState().finishRun(report);
      },
      onError: (error) => {
        useInstallListStore.getState().failRun(error);
      },
      /* A run touches mods, their order, and possibly which profile is active. */
      onSettled: () => {
        client.invalidateQueries({ queryKey: libraryKeys.all });
      },
    }),

  cancel: () =>
    mutationOptions<null, AppError, void>({
      mutationFn: async () => unwrapForQuery(await api.deepLinkInstallListCancel()),
    }),
} as const;
