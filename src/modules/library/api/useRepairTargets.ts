import { useMemo } from "react";

import { type ModHealthVerdict } from "@/lib/tauri";

import { useInstalledMods } from "./queries";
import { useBrokenMods } from "./useBrokenMods";

export interface RepairTargets {
  /** Repairable mods a patch would carry, in library order. */
  enabled: ModHealthVerdict[];
  /** Every repairable mod in the library, in library order. */
  all: ModHealthVerdict[];
}

/**
 * The two scopes a repair can run over, for the drawer's split button.
 *
 * A disabled mod reaches no overlay, so repairing it is work the next game does
 * not need - but it is still the reader's mod, and a library-wide repair is what
 * "Repair all" has always meant. Both lists come back and the surface chooses.
 */
export function useRepairTargets(): RepairTargets {
  const { repairable } = useBrokenMods();
  const { data: mods } = useInstalledMods();

  return useMemo(() => {
    const on = new Set((mods ?? []).filter((mod) => mod.enabled).map((mod) => mod.id));
    return { enabled: repairable.filter((verdict) => on.has(verdict.modId)), all: repairable };
  }, [repairable, mods]);
}
