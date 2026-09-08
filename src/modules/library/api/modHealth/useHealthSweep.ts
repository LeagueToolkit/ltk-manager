import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { type ToastTask, useToast } from "@/components";
import { m } from "@/i18n";
import type { HealthSweepProgress, HealthSweepState } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";

import { libraryKeys } from "../keys";
import { libraryPassQueries, useInstalledMods } from "../queries";

/**
 * What the mod health sweep concluded this launch, and the progress toast while
 * it works.
 *
 * The sweep starts with the app and can finish before this window exists, so
 * the events alone would announce it to nobody. Asking covers a run that
 * already ended, the events cover one still going, and whichever arrives first
 * wins - the same shape as `useLayoutMigration`, for the same reason.
 */
export function useHealthSweep(): HealthSweepState | undefined {
  const toast = useToast();
  const queryClient = useQueryClient();
  const { data: mods = [] } = useInstalledMods();
  const task = useRef<ToastTask | null>(null);

  const closeTask = () => {
    task.current?.close();
    task.current = null;
  };

  const { data: state } = useQuery(libraryPassQueries.healthSweep());

  useTauriEvent<HealthSweepProgress>("health-sweep-progress", (progress) => {
    task.current ??= toast.task(m.library_health_checking_label());

    const [id] = progress.inFlight;
    const name = id ? (mods.find((mod) => mod.id === id)?.displayName ?? id) : "";
    const percent = progress.total > 0 ? (progress.completed / progress.total) * 100 : 0;
    const of = `${progress.completed} of ${progress.total}`;
    task.current.report(percent, name ? `${of} - ${name}` : of);
  });

  useTauriEvent("health-sweep-finished", () => {
    closeTask();
    void queryClient.invalidateQueries({ queryKey: libraryKeys.healthSweep() });
    void queryClient.invalidateQueries({ queryKey: libraryKeys.modHealthVerdicts() });
  });

  // A sweep that ended while this window was closed leaves a toast nobody will
  // ever close through the event.
  const running = isRunning(state);
  useEffect(() => {
    if (running) return;
    task.current?.close();
    task.current = null;
  }, [running]);

  return state;
}

/** Whether the sweep still owes this launch an answer. */
function isRunning(state: HealthSweepState | undefined): boolean {
  return state?.status === "pending" || state?.status === "running";
}
