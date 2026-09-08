import { useCallback } from "react";

import { useToast } from "@/components";
import { errorMessage, m } from "@/i18n";
import { api, type PatcherConfig } from "@/lib/tauri";
import { useStartPatcher } from "@/modules/patcher";

import { checkModForSkinhack } from "../utils/skinhackCheck";
import { useInstalledMods } from "./queries";

/**
 * Shared start path for both the manual and auto-start flows. It force-disables any
 * enabled skinhack mods (which would crash the game), then starts the patcher.
 *
 * Linked-bin dependency issues are no longer gated here: missing linked bins are
 * non-fatal at injection, so the single overlay build inside `start_patcher` records
 * any offenders as a byproduct. They surface afterwards as per-mod badges and a
 * one-time warning toast (see `useSurfaceLinkedBinWarning`) — no pre-flight build,
 * no blocking dialog before the patch.
 */
export function useGuardedStartPatcher() {
  const startPatcher = useStartPatcher();
  const { data: mods = [] } = useInstalledMods();
  const toast = useToast();

  const start = useCallback(
    async (config: PatcherConfig = {}) => {
      if (startPatcher.isPending) return;

      const enabledMods = mods.filter((m) => m.enabled);
      const flaggedMods = enabledMods.filter((m) => checkModForSkinhack(m) != null);
      for (const mod of flaggedMods) {
        await api.toggleMod(mod.id, false);
        toast.warning(
          m.patcher_skinhack_excluded_title(),
          m.patcher_skinhack_excluded_description({ name: mod.displayName }),
        );
      }

      // Nothing safe left to apply once every enabled mod was a flagged skinhack.
      if (flaggedMods.length >= enabledMods.length) {
        return;
      }

      try {
        await startPatcher.mutateAsync(config);
      } catch (error) {
        toast.error(m.patcher_start_failed_title(), errorMessage(error));
        console.error("Failed to start patcher:", error);
      }
    },
    [mods, startPatcher, toast],
  );

  return { start };
}
