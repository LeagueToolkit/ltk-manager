import { useKeys } from "@/modules/keys";
import { usePatcherRunning, useStopPatcher } from "@/modules/patcher/api";
import { useHddWarning } from "@/modules/settings/hooks";

import { useGuardedStartPatcher } from "./useGuardedStartPatcher";

/**
 * Answers `library.import` and `library.patcher` on any page that offers the library's actions.
 *
 * The patcher key starts or stops the patcher, which is what the Play button's tooltip promises
 * wherever that button is drawn.
 */
export function useLibraryHotkeys(importMods: () => void): void {
  const running = usePatcherRunning();
  const { start: guardedStart } = useGuardedStartPatcher();
  const stopPatcher = useStopPatcher();
  const maybeShowHddWarning = useHddWarning();

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

  useKeys("library", { "library.import": () => importMods(), "library.patcher": togglePatcher });
}
