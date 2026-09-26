import { Button } from "@/components";
import { m } from "@/i18n";
import { useStopPatcher } from "@/modules/patcher";
import { usePatcherSessionStore } from "@/stores";

import { runningTint, testTint } from "../../shared/utils/actionTints";

/* The two halves of a test in flight, shared by the row a project draws and the
   row the grid draws over a selection. What starts a test differs between them.
   What one looks like once it is running does not. */

/** The overlay is being built, which is the step with nothing to stop yet. */
export function BuildingTestButton() {
  return (
    <Button variant="ghost" size="sm" loading disabled className={testTint}>
      {m.workshop_card_building_label()}
    </Button>
  );
}

/** The session in flight, and the one control that ends it. */
export function StopTestButton() {
  const stopPatcher = useStopPatcher();
  const stopping = usePatcherSessionStore((s) => s.stopping);

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => stopPatcher.mutate()}
      loading={stopping}
      disabled={stopping}
      left={
        !stopping && (
          <span className="inline-flex h-2 w-2 rounded-full bg-success shadow-[0_0_6px_2px] shadow-success/60" />
        )
      }
      className={runningTint}
    >
      {stopping ? m.workshop_card_stopping_label() : m.workshop_card_stop_test_action()}
    </Button>
  );
}
