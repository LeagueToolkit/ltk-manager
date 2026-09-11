import { queryOptions, useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import { api, type AppError, type BinDocumentId, type VfxSystem } from "@/lib/tauri";
import { unwrapForQuery } from "@/utils/query";

import type { SystemModel } from "./model";
import { readVfxSystem } from "./readVfxSystem";

export const vfxKeys = {
  /**
   * One system read out of an open document.
   *
   * Keyed on the document rather than the asset, so an edit invalidates this key and the
   * viewport swaps the definition against the pool it already holds (decision 2.5 of
   * docs/plans/vfx-particle-renderer.md).
   */
  system: (document: BinDocumentId, entry: string) => ["vfx-system", document, entry] as const,
};

export const vfxQueries = {
  /**
   * The whole object subtree in one call, references chased and assets located.
   *
   * The projected read is the wrong instrument here: a system carries a list of
   * emitters of 139 properties each and `READ_ROW_CAP` bounds one projected read at
   * 2000 rows.
   */
  system: (document: BinDocumentId, entry: string) =>
    queryOptions<VfxSystem, AppError>({
      queryKey: vfxKeys.system(document, entry),
      queryFn: async () => unwrapForQuery(await api.readVfxSystem(document, entry)),
      staleTime: Infinity,
      retry: false,
    }),
};

/** What the viewport reads: the system, and whether the read has answered. */
export interface VfxSystemRead {
  readonly system: SystemModel | null;
  readonly error: AppError | null;
  readonly pending: boolean;
}

/** One `VfxSystemDefinitionData` as the renderer's model. */
export function useVfxSystem(document: BinDocumentId, entry: string): VfxSystemRead {
  const query = useQuery(vfxQueries.system(document, entry));

  const system = useMemo(
    () => (query.data === undefined ? null : readVfxSystem(query.data)),
    [query.data],
  );

  return { system, error: query.error, pending: query.isPending };
}
