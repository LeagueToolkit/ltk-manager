import { useMemo } from "react";

import { type ModHealthVerdict } from "@/lib/tauri";

import { useInstalledMods } from "./queries";
import { useBrokenMods } from "./useBrokenMods";

/**
 * The unhealthy mods a patch would actually carry, repairable or not.
 *
 * A disabled mod reaches no overlay, so its verdict is not what a launch is
 * about - warning over one would teach the reader to press through the warning
 * that matters.
 */
export function useBrokenEnabledMods(): ModHealthVerdict[] {
  const { repairable, unrepairable } = useBrokenMods();
  const { data: mods } = useInstalledMods();

  return useMemo(() => {
    const enabled = new Set((mods ?? []).filter((mod) => mod.enabled).map((mod) => mod.id));
    return [...repairable, ...unrepairable].filter((verdict) => enabled.has(verdict.modId));
  }, [repairable, unrepairable, mods]);
}
