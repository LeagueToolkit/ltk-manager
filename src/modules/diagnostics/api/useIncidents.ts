import { useQuery } from "@tanstack/react-query";

import { api, type AppError, type Incident } from "@/lib/tauri";
import { queryFn } from "@/utils/query";

import { diagnosticsKeys } from "./keys";

/**
 * Every incident the store holds, newest first.
 *
 * Stable until `incident-recorded` or a dismiss invalidates it, because the
 * backend is the only writer and it announces every write.
 */
export function useIncidents() {
  return useQuery<Incident[], AppError>({
    queryKey: diagnosticsKeys.incidents(),
    queryFn: queryFn(api.listIncidents),
    staleTime: Infinity,
  });
}

/** One incident by id, out of the same list query. */
export function useIncident(id: string | null | undefined) {
  const incidents = useIncidents();
  const incident = id ? (incidents.data?.find((candidate) => candidate.id === id) ?? null) : null;
  return { ...incidents, incident };
}

/**
 * The newest incident the user has not dismissed, which is the one the title
 * bar's dot and a mod's suspect badge speak for.
 */
export function useLatestIncident() {
  const incidents = useIncidents();
  const latest = incidents.data?.find((incident) => !incident.dismissed) ?? null;
  return { ...incidents, latest };
}
