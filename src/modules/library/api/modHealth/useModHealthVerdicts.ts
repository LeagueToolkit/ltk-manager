import { useQuery } from "@tanstack/react-query";

import { modQueries } from "../queries";

/** Every remembered mod health verdict, in one IPC call. */
export function useModHealthVerdicts() {
  return useQuery(modQueries.healthVerdicts());
}

/**
 * The remembered health verdict for one mod.
 *
 * Null for a mod that has never been checked. Reads from the shared batch query,
 * so no extra IPC call.
 */
export function useModHealthVerdict(modId: string) {
  return useQuery({
    ...modQueries.healthVerdicts(),
    select: (verdicts) => verdicts[modId] ?? null,
  });
}
