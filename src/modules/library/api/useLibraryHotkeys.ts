import { useHotkeys } from "react-hotkeys-hook";

import { useGuardedStartPatcher, usePatcherStatus, useStopPatcher } from "@/modules/patcher";
import { useHddWarning } from "@/modules/settings";

/**
 * The library's keys, on any page that offers its actions.
 *
 * Ctrl+I imports, and Ctrl+P starts or stops the patcher, which is what the
 * Play button's tooltip promises wherever that button is drawn.
 */
export function useLibraryHotkeys(importMods: () => void): void {
  const { data: patcherStatus } = usePatcherStatus();
  const { start: guardedStart } = useGuardedStartPatcher();
  const stopPatcher = useStopPatcher();
  const maybeShowHddWarning = useHddWarning();

  const running = patcherStatus?.running ?? false;

  async function startPatcher() {
    await maybeShowHddWarning();

    // Shared start path: force-disables skinhacks, then starts. Linked-bin
    // offenders surface afterwards via badges + a warning toast, not a pre-flight.
    await guardedStart({});
  }

  function togglePatcher() {
    if (running) {
      stopPatcher.mutate(undefined, {
        onError: (error) => {
          console.error("Failed to stop patcher:", error);
        },
      });
      return;
    }
    void startPatcher();
  }

  useHotkeys("ctrl+i", () => importMods(), { preventDefault: true, enabled: !running });
  useHotkeys("ctrl+p", togglePatcher, { preventDefault: true });
}
