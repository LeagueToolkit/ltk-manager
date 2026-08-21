import { useLatestIncident } from "./useIncidents";
import { useIncidentToken } from "./useIncidentToken";

/**
 * The newest undismissed incident as its token, for the bug report URL.
 *
 * `null` while there is no such incident, or until the backend has encoded it.
 */
export function useLatestIncidentToken(): string | null {
  const { latest } = useLatestIncident();
  const { data } = useIncidentToken(latest?.id);

  if (!latest) return null;
  return data ?? null;
}
