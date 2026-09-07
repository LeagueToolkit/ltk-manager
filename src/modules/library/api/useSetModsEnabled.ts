import { useCallback } from "react";

import type { InstalledMod } from "@/lib/tauri";
import { checkModForSkinhack } from "@/modules/library/utils/skinhackCheck";

import { useToggleMod } from "./useToggleMod";

/**
 * Switch a set of mods on or off, skipping the ones already in that state.
 *
 * A blocked mod is skipped on the way on, because a card refuses the same press
 * one at a time and a set is not a way around that. Switching one off is always
 * offered.
 */
export function useSetModsEnabled() {
  const toggleMod = useToggleMod();

  const setEnabled = useCallback(
    (mods: InstalledMod[], enabled: boolean) => {
      for (const mod of mods) {
        if (mod.enabled === enabled) continue;
        if (enabled && checkModForSkinhack(mod)) continue;
        toggleMod.mutate(
          { modId: mod.id, enabled },
          { onError: (error) => console.error("Failed to toggle mod:", error) },
        );
      }
    },
    [toggleMod],
  );

  return { setEnabled, isPending: toggleMod.isPending } as const;
}
