import { useQuery } from "@tanstack/react-query";

import type { Incident } from "@/lib/tauri";

import { diagnosticsQueries } from "./queries";

/** Every incident the store holds, newest first. */
export function useIncidents() {
  return useQuery(diagnosticsQueries.incidents());
}

/* Both selectors below read `data` alone rather than spreading the query result,
   so a caller re-renders on the list and not on every field of its fetch. */

/** One incident by id, out of the same list query. Null until the list holds it. */
export function useIncident(id: string | null | undefined): Incident | null {
  const { data } = useIncidents();
  if (!id) return null;
  return data?.find((candidate) => candidate.id === id) ?? null;
}

/**
 * The newest incident the user has not dismissed, which is the one the title
 * bar's dot and a mod's suspect badge speak for.
 */
export function useLatestIncident(): Incident | null {
  const { data } = useIncidents();
  return data?.find((incident) => !incident.dismissed) ?? null;
}
