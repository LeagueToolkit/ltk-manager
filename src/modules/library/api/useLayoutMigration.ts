import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";

import { type ToastTask, useToast } from "@/components";
import type { LayoutMigrationProgress, LayoutMigrationReport } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";

import { libraryKeys } from "./keys";
import { libraryPassQueries } from "./queries";

/**
 * Drives what the user sees of the library layout migration, and reports the
 * mods it could not move.
 *
 * The run starts with the app and can finish before this window exists, so the
 * events alone would announce it to nobody. Asking covers a run that already
 * ended, the events cover one still going, and whichever arrives first wins.
 * The backend answers `pending` until the startup pass has something to say,
 * which is what closes the gap where neither would have landed.
 */
export function useLayoutMigration(): LayoutMigrationReport | null {
  const toast = useToast();
  const queryClient = useQueryClient();
  const task = useRef<ToastTask | null>(null);
  const announced = useRef(false);
  const [live, setLive] = useState<LayoutMigrationReport | null>(null);

  const { data: state } = useQuery(libraryPassQueries.migrationState());

  useTauriEvent<LayoutMigrationProgress>("layout-migration-progress", (progress) => {
    task.current ??= toast.task("Upgrading your mod library");
    const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
    task.current.report(
      percent,
      `${progress.current} of ${progress.total} - ${progress.currentMod}`,
    );
  });

  useTauriEvent<LayoutMigrationReport>("layout-migration-finished", setLive);

  const asked = state?.status === "finished" ? state.report : null;
  const outcome = live ?? asked;

  useEffect(() => {
    if (!outcome || announced.current) return;
    announced.current = true;

    task.current?.close();
    task.current = null;
    queryClient.invalidateQueries({ queryKey: libraryKeys.mods() });

    if (outcome.failed.length === 0) {
      const plural = outcome.migrated === 1 ? "mod" : "mods";
      toast.success("Library upgraded", `${outcome.migrated} ${plural} moved into the new layout.`);
    }
  }, [outcome, queryClient, toast]);

  return outcome;
}
