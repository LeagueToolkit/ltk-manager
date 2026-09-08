import { useMemo } from "react";

import type { WadScanFailureInfo } from "@/lib/tauri";

import { useInstalledMods } from "./queries";
import { useAllModWadReports } from "./useModWadReport";

export interface WadScanOffender {
  modId: string;
  displayName: string;
  /** Offending WADs (as reported by the injector) this mod edits. */
  wads: string[];
}

export interface WadScanOffenders {
  /** Enabled library mods matched to one or more offending WADs. */
  offenders: WadScanOffender[];
  /** Offending WADs not edited by any enabled library mod (e.g. a workshop project). */
  unmatchedWads: string[];
  /** True while the underlying reports/mods queries are still loading. */
  isLoading: boolean;
}

/** Last path segment, lowercased — `DATA/FINAL/Champions/Ahri.wad.client` → `ahri.wad.client`. */
function wadBasename(path: string): string {
  const segments = path.split(/[\\/]/);
  return (segments[segments.length - 1] ?? path).toLowerCase();
}

/**
 * Associate the failing WAD files (from the integrity scan) with the enabled
 * library mods that edit them, by matching WAD basenames against each mod's
 * footprint (`affectedWads`). Handles multiple failing WADs and multiple mods
 * per WAD; a WAD with no matching enabled mod falls into `unmatchedWads`.
 */
export function useWadScanOffenders(failures: WadScanFailureInfo[]): WadScanOffenders {
  const { data: reports, isLoading: reportsLoading } = useAllModWadReports();
  const { data: mods, isLoading: modsLoading } = useInstalledMods();

  return useMemo(() => {
    const wads = failures.map((f) => f.wad).filter((wad): wad is string => !!wad);

    // Map each failing basename back to the injector's original string so we
    // display what the scan reported, not a lowercased path fragment.
    const failingByBasename = new Map<string, string>();
    for (const wad of wads) {
      failingByBasename.set(wadBasename(wad), wad);
    }

    const offenders: WadScanOffender[] = [];
    const matchedBasenames = new Set<string>();

    if (reports && mods) {
      for (const mod of mods) {
        if (!mod.enabled) continue;
        const report = reports[mod.id];
        if (!report) continue;

        const hits = new Set(
          report.affectedWads
            .map(wadBasename)
            .filter((basename) => failingByBasename.has(basename)),
        );
        if (hits.size === 0) continue;

        hits.forEach((basename) => matchedBasenames.add(basename));
        offenders.push({
          modId: mod.id,
          displayName: mod.displayName,
          wads: [...hits].map((basename) => failingByBasename.get(basename) ?? basename),
        });
      }
    }

    const unmatchedWads = wads.filter((wad) => !matchedBasenames.has(wadBasename(wad)));

    return { offenders, unmatchedWads, isLoading: reportsLoading || modsLoading };
  }, [failures, reports, mods, reportsLoading, modsLoading]);
}
