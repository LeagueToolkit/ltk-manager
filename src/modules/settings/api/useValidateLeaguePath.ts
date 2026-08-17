import { useQuery } from "@tanstack/react-query";

import { api, type AppError } from "@/lib/tauri";
import { queryFnWithArgs } from "@/utils/query";

import { settingsKeys } from "./keys";

/**
 * Reports whether a path holds a League of Legends installation.
 *
 * Idle while there is no path, so `undefined` covers both "not checked" and a
 * check that failed.
 */
export function useValidateLeaguePath(path: string | null | undefined) {
  return useQuery<boolean, AppError>({
    queryKey: settingsKeys.leaguePathValid(path ?? ""),
    queryFn: queryFnWithArgs(api.validateLeaguePath, path ?? ""),
    enabled: !!path,
    retry: false,
  });
}
