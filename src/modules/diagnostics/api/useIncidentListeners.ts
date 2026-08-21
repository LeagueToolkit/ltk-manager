import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { useToast } from "@/components";
import type { Incident } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { useIncidentLineStore } from "@/stores";

import { isInformational } from "../utils/incident";
import { diagnosticsKeys } from "./keys";

/**
 * The root's subscriptions for incidents.
 *
 * `incident-recorded` refreshes the list, puts the verdict line in the session
 * bar, and announces it with a toast whose `Details` action opens the Games
 * tab on the incident. The toast is kept in the notification center, because a
 * crash is a question the player comes back to. A start failure gets no toast
 * here, because `usePatcherError` already announced it with the stage's own
 * action. `patcher-game-attached` takes the line down again, since the bar's
 * job is the present.
 */
export function useIncidentListeners() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const show = useIncidentLineStore((s) => s.show);
  const clear = useIncidentLineStore((s) => s.clear);

  useTauriEvent<Incident>("incident-recorded", (incident) => {
    queryClient.invalidateQueries({ queryKey: diagnosticsKeys.incidents() });
    show(incident);
    if (incident.verdict.kind === "patcher-did-not-run") return;
    toast.toast({
      type: toastTypeFor(incident),
      title: incident.verdict.title,
      description: incident.verdict.cause,
      notify: true,
      action: {
        label: "Details",
        onClick: () =>
          navigate({ to: "/diagnostics", search: { tab: "games", incident: incident.id } }),
      },
    });
  });

  useTauriEvent<unknown>("patcher-game-attached", () => clear());
}

function toastTypeFor(incident: Incident) {
  return isInformational(incident.verdict.kind) ? ("info" as const) : ("warning" as const);
}
