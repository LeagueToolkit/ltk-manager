import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { useToast } from "@/components";
import { m } from "@/i18n";
import type { Incident } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { scanRejectionCause, useRebuildOverlayAction } from "@/modules/patcher";
import { useSettings } from "@/modules/settings";
import { useIncidentLineStore, useInstallMismatchStore } from "@/stores";
import { slashed } from "@/utils";

import { offersRebuild } from "../utils/hints";
import { isInformational } from "../utils/incident";
import { diagnosticsKeys } from "./keys";

/**
 * The root's subscriptions for incidents.
 *
 * `incident-recorded` refreshes the list, puts the verdict line in the session
 * bar, and announces it with a toast whose `Details` action opens the Games
 * tab on the incident, and a `Rebuild overlay` action beside it whenever the
 * verdict carries the rebuild hint. The toast is kept in the notification
 * center, because a crash is a question the player comes back to. A start
 * failure gets no toast here, because `usePatcherError` already announced it
 * with the stage's own action. A wrong-install verdict raises the install
 * mismatch dialog with the log's install as the switch target.
 * `patcher-game-attached` takes the line down again, since the bar's job is
 * the present.
 */
export function useIncidentListeners() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const show = useIncidentLineStore((s) => s.show);
  const clear = useIncidentLineStore((s) => s.clear);
  const rebuild = useRebuildOverlayAction();
  const raiseMismatch = useInstallMismatchStore((s) => s.raise);
  const { data: settings } = useSettings();

  useTauriEvent<Incident>("incident-recorded", (incident) => {
    queryClient.invalidateQueries({ queryKey: diagnosticsKeys.incidents() });
    show(incident);
    const ranFrom = incident.game?.gameBaseDir;
    const configuredPath = settings?.leaguePath;
    if (incident.verdict.kind === "wrong-install" && ranFrom && configuredPath) {
      raiseMismatch({
        configuredPath: slashed(configuredPath),
        configuredPatchline: null,
        sessionPath: ranFrom,
        sessionPatchline: null,
      });
    }
    if (incident.verdict.kind === "patcher-did-not-run") return;
    toast.toast({
      type: toastTypeFor(incident),
      title: incident.verdict.title,
      description: scanRejectionCause(incident),
      notify: true,
      action: {
        label: m.diagnostics_incident_details_action(),
        onClick: () =>
          navigate({ to: "/diagnostics", search: { tab: "games", incident: incident.id } }),
      },
      actions: offersRebuild(incident.verdict)
        ? [{ label: rebuild.label, onClick: rebuild.run }]
        : [],
    });
  });

  useTauriEvent<unknown>("patcher-game-attached", () => clear());
}

function toastTypeFor(incident: Incident) {
  return isInformational(incident.verdict.kind) ? ("info" as const) : ("warning" as const);
}
