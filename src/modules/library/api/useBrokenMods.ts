import { useMemo } from "react";

import { type ModHealthVerdict } from "@/lib/tauri";

import { useInstalledMods } from "./queries";
import { useModHealthVerdicts } from "./useModHealthVerdicts";

export interface BrokenMods {
  /** Verdicts a repair would fix, in library order. */
  repairable: ModHealthVerdict[];
  /** Verdicts with findings and no fix for any, in library order. */
  unrepairable: ModHealthVerdict[];
}

/**
 * The library's unhealthy mods, split by whether a repair can reach them.
 *
 * Walks the installed mods and looks each verdict up, rather than walking the
 * verdicts: a verdict outlives the mod it describes until the next sweep prunes
 * it, and it carries no name for a row to draw either way.
 */
export function useBrokenMods(): BrokenMods {
  const { data: verdicts } = useModHealthVerdicts();
  const { data: mods } = useInstalledMods();

  return useMemo(() => {
    const found = (mods ?? [])
      .map((mod) => verdicts?.[mod.id])
      .filter((verdict): verdict is ModHealthVerdict => verdict !== undefined);

    return {
      repairable: found.filter((verdict) => verdict.health === "repairable"),
      unrepairable: found.filter((verdict) => verdict.health === "unrepairable"),
    };
  }, [mods, verdicts]);
}
