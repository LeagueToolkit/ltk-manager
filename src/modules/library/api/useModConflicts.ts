import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api, type AppError, type ConflictGroup } from "@/lib/tauri";
import { queryFn, unwrapForQuery } from "@/utils/query";

import { libraryKeys } from "./keys";

/** Shared files between enabled mods, scanned while `enabled`. */
export function useModConflicts(enabled: boolean) {
  return useQuery(
    queryOptions<ConflictGroup[], AppError>({
      queryKey: libraryKeys.conflicts(),
      queryFn: queryFn(api.getModConflicts),
      enabled,
      staleTime: 0,
    }),
  );
}

export function useSetConflictWinner() {
  const client = useQueryClient();
  return useMutation<ConflictGroup[], AppError, { key: string; winner: string | null }>({
    mutationFn: async ({ key, winner }) => unwrapForQuery(await api.setConflictWinner(key, winner)),
    onSuccess: (groups) => client.setQueryData(libraryKeys.conflicts(), groups),
  });
}
