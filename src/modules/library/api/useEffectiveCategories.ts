import { useMemo } from "react";

import type { InstalledMod } from "@/lib/tauri";
import { computeEffectiveCategories, type EffectiveCategories } from "@/modules/library/utils";
import { useSettings } from "@/modules/settings";

import { useAllModWadReports } from "./useModWadReport";

/**
 * Join each mod with its (sparse) WAD-footprint report to produce its
 * "effective" categories — declared metadata unioned with values derived from
 * the footprint. Reads the shared batch report query, so no per-mod IPC.
 *
 * Every mod gets an entry; mods without a report contribute declared-only
 * values. When auto-categorization is disabled in settings, the derived
 * footprint is ignored entirely so only user-declared categories remain.
 */
export function useEffectiveCategories(mods: InstalledMod[]): Map<string, EffectiveCategories> {
  const { data: reports } = useAllModWadReports();
  const { data: settings } = useSettings();
  const autoEnabled = settings?.autoCategorizationEnabled ?? true;

  return useMemo(() => {
    const map = new Map<string, EffectiveCategories>();
    for (const mod of mods) {
      map.set(mod.id, computeEffectiveCategories(mod, autoEnabled ? reports?.[mod.id] : undefined));
    }
    return map;
  }, [mods, reports, autoEnabled]);
}

/**
 * Effective categories for a single mod. Reads the shared batch report query —
 * the matching component owns its own data rather than receiving it as a prop.
 */
export function useModEffectiveCategories(mod: InstalledMod): EffectiveCategories {
  const { data: reports } = useAllModWadReports();
  const { data: settings } = useSettings();
  const autoEnabled = settings?.autoCategorizationEnabled ?? true;

  return useMemo(
    () => computeEffectiveCategories(mod, autoEnabled ? reports?.[mod.id] : undefined),
    [mod, reports, autoEnabled],
  );
}
