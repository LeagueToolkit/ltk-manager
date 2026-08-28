import type { HealthSweepState, InstalledMod, ModHealth, ModHealthVerdict } from "@/lib/tauri";

interface VerdictShape {
  /** Findings a repair would fix. Ignored for a verdict that is not repairable. */
  fixable?: number;
  /** Live findings behind the verdict, at whatever severity. */
  findings?: number;
}

export function verdict(
  modId: string,
  health: ModHealth,
  { fixable = 2, findings = 3 }: VerdictShape = {},
): ModHealthVerdict {
  return {
    modId,
    health,
    fixable: health === "repairable" ? fixable : 0,
    counts: { fatals: health === "healthy" ? 0 : findings, errors: 0, warnings: 0, infos: 0 },
    checkedAt: "2026-08-28T10:00:00Z",
    basis: { build: "16.17.8087655", manager: "1.14.3" },
  };
}

export function installedMod(id: string, displayName: string): InstalledMod {
  return {
    id,
    name: id,
    displayName,
    version: "1.0.0",
    description: null,
    authors: [],
    enabled: true,
    installedAt: "2026-08-01T10:00:00Z",
    layers: [],
    tags: [],
    champions: [],
    maps: [],
    modDir: `/storage/mods/${id}`,
    format: "fantome",
    storage: "project",
    hasArchive: false,
    folderId: null,
  };
}

/** A sweep that ran and reported, which is what the banner draws on. */
export function finishedSweep(build: string | null = "16.17.8087655"): HealthSweepState {
  return {
    status: "finished",
    report: {
      basis: { build, manager: "1.14.3" },
      checked: 3,
      skipped: 0,
      repairable: [],
      unrepairable: [],
    },
  };
}
