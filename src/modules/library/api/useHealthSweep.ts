import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";

import { type ToastTask, useToast } from "@/components";
import { api, type AppError, type HealthSweepProgress, type HealthSweepState } from "@/lib/tauri";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { queryFn } from "@/utils/query";

import { libraryKeys } from "./keys";
import { useInstalledMods } from "./queries";

/** How often to ask again while the sweep has not reported. */
const SWEEP_POLL_MS = 400;

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

  const { data: state } = useQuery<HealthSweepState, AppError>({
    queryKey: libraryKeys.healthSweep(),
    queryFn: queryFn(api.getHealthSweep),
    // Both states are still owed an answer, and asking covers the sliver
    // between this mounting and its listener being registered, where the
    // finishing event would reach nobody.
    refetchInterval: (query) => (isRunning(query.state.data) ? SWEEP_POLL_MS : false),
  });

  useTauriEvent<HealthSweepProgress>("health-sweep-progress", (progress) => {
    task.current ??= toast.task("Checking your mods");

    const name = mods.find((mod) => mod.id === progress.modId)?.displayName ?? progress.modId;
    const percent = progress.total > 0 ? (progress.current / progress.total) * 100 : 0;
    task.current.report(percent, `${progress.current} of ${progress.total} - ${name}`);
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
