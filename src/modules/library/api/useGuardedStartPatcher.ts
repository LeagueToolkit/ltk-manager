import { useCallback } from "react";

import { useToast } from "@/components/Toast";
import { errorMessage, m } from "@/i18n";
import { api, type PatcherConfig } from "@/lib/tauri";
import { useFixLeagueElevated } from "@/modules/diagnostics/api";
import { useStartPatcher } from "@/modules/patcher/api";
import { useSettings } from "@/modules/settings/api";
import { hasBuiltinMods } from "@/modules/settings/builtinMods";
import { isAppError } from "@/utils/errors";

import { checkModForSkinhack } from "../utils/skinhackCheck";
import { useInstalledMods } from "./queries";

/** How long the refusal stays up, in milliseconds, so the reader can press Fix. */
const LEAGUE_ELEVATED_TOAST_MS = 15000;

function isLeagueElevatedError(error: unknown): boolean {
  return isAppError(error) && error.code === "PATCHER" && error.error.kind === "LEAGUE_ELEVATED";
}

/**
 * Shared start path for both the manual and auto-start flows. It force-disables any
 * enabled skinhack mods (which would crash the game), then starts the patcher.
 */
export function useGuardedStartPatcher() {
  const startPatcher = useStartPatcher();
  const { data: mods = [] } = useInstalledMods();
  const { data: settings } = useSettings();
  const toast = useToast();
  const fixLeagueElevated = useFixLeagueElevated();

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
      if (flaggedMods.length >= enabledMods.length && !hasBuiltinMods(settings)) {
        return;
      }

      try {
        await startPatcher.mutateAsync(config);
      } catch (error) {
        console.error("Failed to start patcher:", error);

        if (isLeagueElevatedError(error)) {
          toast.toast({
            type: "error",
            title: m["patcher.LEAGUE_ELEVATED.title"](),
            description: m["patcher.LEAGUE_ELEVATED.description"](),
            timeout: LEAGUE_ELEVATED_TOAST_MS,
            action: {
              label: m["patcher.LEAGUE_ELEVATED.fix_action"](),
              onClick: () => void fixLeagueElevated(),
            },
          });
          return;
        }

        toast.error(m.patcher_start_failed_title(), errorMessage(error));
      }
    },
    [fixLeagueElevated, mods, settings, startPatcher, toast],
  );

  return { start };
}
