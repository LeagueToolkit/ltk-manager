import { useQueryClient } from "@tanstack/react-query";
import { listen } from "@tauri-apps/api/event";
import { useEffect, useRef } from "react";

import type { OverlayProgress } from "@/lib/tauri";
import { useTauriProgress } from "@/lib/useTauriProgress";
import { usePatcherStatus } from "@/modules/patcher/api";

import { libraryKeys } from "./keys";

const TERMINAL_STAGES = ["complete"];

/**
 * The overlay build's progress: the last `overlay-progress` event, or the one the patcher
 * status kept while this hook was not mounted to hear it.
 */
export function useOverlayProgress(): OverlayProgress | null {
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

  // Same for the checksum-mismatch advisories in mod details.
  useEffect(() => {
    const unlisten = listen("checksum-mismatches-updated", () => {
      queryClient.invalidateQueries({ queryKey: libraryKeys.checksumMismatches() });
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

  // The status is polled every second while the patcher runs, so a build that started
  // before this hook mounted still shows its step.
  const kept = patcherStatus?.phase === "building" ? patcherStatus.overlayProgress : null;
  return progress ?? kept;
}
