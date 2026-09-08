import { mutationOptions, type QueryClient } from "@tanstack/react-query";

import { api, type AppError, type DecodedIncident, type Incident } from "@/lib/tauri";
import { useIncidentLineStore } from "@/stores";
import { mutationFn, unwrapForQuery } from "@/utils/query";

import { diagnosticsKeys } from "./keys";

/** The incident list as it stood before an optimistic dismiss. */
interface IncidentsRollback {
  previous?: Incident[];
}

/** Hold the incident list, apply `edit`, and hand back the rollback. */
async function holdIncidents(
  client: QueryClient,
  edit: (incidents: Incident[]) => Incident[],
): Promise<IncidentsRollback> {
  await client.cancelQueries({ queryKey: diagnosticsKeys.incidents() });
  const previous = client.getQueryData<Incident[]>(diagnosticsKeys.incidents());
  client.setQueryData<Incident[]>(diagnosticsKeys.incidents(), (old) => (old ? edit(old) : old));
  return { previous };
}

/** Put back what `holdIncidents` snapshotted. */
function releaseIncidents(client: QueryClient, context: IncidentsRollback | undefined): void {
  if (context?.previous) client.setQueryData(diagnosticsKeys.incidents(), context.previous);
}

/** Invalidate the incident list once a write has settled either way. */
function refreshIncidents(client: QueryClient): void {
  client.invalidateQueries({ queryKey: diagnosticsKeys.incidents() });
}

/* Both dismisses are optimistic, because the flag is the user's own statement
   and the backend has no reason to disagree. The rows stay in the list, dimmed. */

/** Writes against the incidents the store holds. */
export const incidentMutations = {
  dismiss: (client: QueryClient) =>
    mutationOptions<null, AppError, string, IncidentsRollback>({
      mutationFn: async (id) => unwrapForQuery(await api.diagnostics.dismissIncident(id)),
      onMutate: (id) => {
        useIncidentLineStore.getState().clear(id);
        return holdIncidents(client, (incidents) =>
          incidents.map((incident) =>
            incident.id === id ? { ...incident, dismissed: true } : incident,
          ),
        );
      },
      onError: (_error, _id, context) => releaseIncidents(client, context),
      onSettled: () => refreshIncidents(client),
    }),

  dismissAll: (client: QueryClient) =>
    mutationOptions<string[], AppError, void, IncidentsRollback>({
      mutationFn: async () => unwrapForQuery(await api.diagnostics.dismissAllIncidents()),
      onMutate: () => {
        useIncidentLineStore.getState().clear();
        return holdIncidents(client, (incidents) =>
          incidents.map((incident) =>
            incident.dismissed ? incident : { ...incident, dismissed: true },
          ),
        );
      },
      onError: (_error, _variables, context) => releaseIncidents(client, context),
      onSettled: () => refreshIncidents(client),
    }),

  /** Reveal an incident's `r3dlog`. Fails for an incident with no log. */
  revealGameLog: () =>
    mutationOptions<null, AppError, string>({
      /* IncidentDetail reports. */
      meta: { silentError: true },
      mutationFn: mutationFn(api.diagnostics.revealGameLog),
    }),

  /* The backend accepts a bare token, or a report or URL with one inside, so the
     caller passes the paste through untouched. Its error is a sentence meant to
     be shown as it is. */
  decodeToken: () =>
    mutationOptions<DecodedIncident, AppError, string>({
      mutationFn: mutationFn(api.diagnostics.decodeIncidentToken),
    }),
} as const;
