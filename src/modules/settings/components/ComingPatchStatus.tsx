import { useQuery } from "@tanstack/react-query";

import { m } from "@/i18n";
import type { PatchStatus } from "@/lib/tauri";

import { settingsQueries } from "../api/queries";
import { useLoadedSettings } from "../api/useUpdateSettings";

/** Read patch support independently of whether forward-looking findings are enabled. */
export function ComingPatchStatus() {
  const settings = useLoadedSettings();
  const query = useQuery(settingsQueries.patchStatus(settings.leaguePath));
  if (!query.isSuccess) return null;
  return <PatchStatusHint status={query.data} />;
}

/** A rule that is still dormant has no idle-setting explanation. */
export function PatchStatusHint({ status }: { status: PatchStatus }) {
  if (status.waitingPatch !== null) return null;
  return <p className="text-xs text-surface-400">{patchStatusMessage(status)}</p>;
}

function patchStatusMessage(status: PatchStatus): string {
  let known = m.settings_patch_status_known_build({ build: status.knownBuild });
  if (status.knownPatch !== null) {
    known = m.settings_patch_status_known_patch({ patch: status.knownPatch });
  }
  if (!status.installConfigured) return m.settings_patch_status_unconfigured({ known });
  if (status.installedPatch === null) return m.settings_patch_status_unreadable({ known });
  return m.settings_patch_status_installed({ known, patch: status.installedPatch });
}
