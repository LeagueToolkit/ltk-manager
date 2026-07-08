import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import type { OverlayProgress } from "@/lib/tauri";
import { useTauriProgress } from "@/lib/useTauriProgress";
import { libraryKeys } from "@/modules/library";

import { usePatcherStatus } from "./usePatcherStatus";

const TERMINAL_STAGES = ["complete"];

export function useOverlayProgress() {
  const { progress, clear } = useTauriProgress<OverlayProgress>("overlay-progress", {
    terminalStages: TERMINAL_STAGES,
  });
  const { data: patcherStatus } = usePatcherStatus();
  const wasPatcherRunning = useRef(false);
  const queryClient = useQueryClient();

  // Refresh per-mod WAD reports when the backend signals that the cache has
  // been updated. This fires *after* `record_reports()` persists the data,
  // avoiding the race where `OverlayStage::Complete` arrives before the
  // cache is written.
  useEffect(() => {
    const unlisten = listen("wad-reports-updated", () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.wadReports() });
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [queryClient]);

  // Refresh the linked-bin offender badges when a build records a fresh snapshot.
  useEffect(() => {
    const unlisten = listen("linked-bins-updated", () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.linkedBinOffenders() });
    });
    return () => {
      unlisten.then((fn) => fn()).catch(() => {});
    };
  }, [queryClient]);

  useEffect(() => {
    const isPatcherRunning = patcherStatus?.running ?? false;

    if (wasPatcherRunning.current && !isPatcherRunning) {
      clear();
    }

    wasPatcherRunning.current = isPatcherRunning;
  }, [patcherStatus?.running, clear]);

  return progress;
}
