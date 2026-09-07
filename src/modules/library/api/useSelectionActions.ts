import { useMemo } from "react";

import type { HealthCheckReadiness, InstalledMod } from "@/lib/tauri";
import { usePatcherStatus } from "@/modules/patcher";
import { useLibraryDialogsStore, useLibrarySelectionStore } from "@/stores";

import { useHealthCheckReadiness, useSweepModHealth } from "./modHealth";
import { useInstalledMods } from "./queries";
import { useSetModsEnabled } from "./useSetModsEnabled";

/** What a selection can be asked to do, for whichever surface is asking. */
export interface SelectionActions {
  mods: InstalledMod[];
  count: number;
  enable: () => void;
  disable: () => void;
  checkHealth: () => void;
  uninstall: () => void;
  clear: () => void;
  canEnable: boolean;
  canDisable: boolean;
  canUninstall: boolean;
  checkReadiness: HealthCheckReadiness;
  checkPending: boolean;
}

/**
 * The five commands a selection carries, bound to the mods currently picked.
 *
 * The floating bar and a selected card's right click both hang off this, so the
 * two ways into a bulk action cannot drift into offering different ones. Per
 * "What a selection carries" in `docs/ux/LIBRARY.md`.
 */
export function useSelectionActions(): SelectionActions {
  const selectedIds = useLibrarySelectionStore((s) => s.selectedIds);
  const clear = useLibrarySelectionStore((s) => s.clear);
  const openBulkUninstallDialog = useLibraryDialogsStore((s) => s.openBulkUninstallDialog);

  const { data: allMods = [] } = useInstalledMods();
  const { data: patcherStatus } = usePatcherStatus();
  const { setEnabled } = useSetModsEnabled();
  const sweepHealth = useSweepModHealth();
  const checkReadiness = useHealthCheckReadiness();

  const mods = useMemo(() => allMods.filter((m) => selectedIds.has(m.id)), [allMods, selectedIds]);
  const count = mods.length;
  const enabledCount = mods.reduce((n, m) => n + (m.enabled ? 1 : 0), 0);
  // A patcher run owns the library, and every write to a mod is refused while it does.
  const patcherRunning = patcherStatus?.running ?? false;

  return {
    mods,
    count,
    enable: () => setEnabled(mods, true),
    disable: () => setEnabled(mods, false),
    /* The picks are spent by the press rather than by the run landing. The run
       reports through its own progress toast, and a popup that closes as it is
       pressed takes any completion callback down with it. */
    checkHealth: () => {
      sweepHealth.mutate(mods.map((m) => m.id));
      clear();
    },
    uninstall: () => count > 0 && openBulkUninstallDialog(mods),
    clear,
    canEnable: enabledCount < count && !patcherRunning,
    canDisable: enabledCount > 0 && !patcherRunning,
    canUninstall: count > 0 && !patcherRunning,
    checkReadiness,
    checkPending: sweepHealth.isPending,
  };
}
