import type { ReactNode } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { useEmitters } from "../emitterChoice";
import { useVfxRun, type VfxRun } from "./run";
import { chosenEmitter } from "./selection";
import { speedDetent } from "./Transport";

/** How many frames Shift and an arrow move, which is a tenth of a second. */
const SHIFT_FRAMES = 6;

/** Controls whose own keys are the arrows and Space, which the run's keys leave alone. */
const KEYED_CONTROLS = "[role='slider'], [role='tab'], [role='menuitem'], [role='option']";

/** What each key does to the run, "The keys" in docs/ux/BIN_EDITOR.md. Esc is the pane tree's. */
const KEYS: Record<string, (run: VfxRun, selected: number | null) => void> = {
  space: (run) => run.setPlaying(!run.playing),
  left: (run) => run.step(-1),
  right: (run) => run.step(1),
  "shift+left": (run) => run.step(-SHIFT_FRAMES),
  "shift+right": (run) => run.step(SHIFT_FRAMES),
  home: (run) => run.restart(),
  f: (run) => run.requestFit(),
  s: (run, selected) => selected !== null && run.toggleSoloed(selected),
  m: (run, selected) => selected !== null && run.toggleMuted(selected),
  bracketleft: (run) => run.setSpeed(speedDetent(run.speed, -1)),
  bracketright: (run) => run.setSpeed(speedDetent(run.speed, 1)),
};

/**
 * The run's keys, live wherever focus stands inside this box and outside an editable field.
 *
 * The box takes focus itself, so a click on bare pane ground is enough to arm them.
 */
export function RunKeys({ children }: { children: ReactNode }) {
  const run = useVfxRun();
  const { root } = useEmitters();

  const ref = useHotkeys<HTMLDivElement>(
    Object.keys(KEYS).join(", "),
    (_, handler) => KEYS[handler.hotkey]?.(run, chosenEmitter(run.system, root)),
    {
      preventDefault: true,
      ignoreEventWhen: (event) =>
        event.target instanceof Element && event.target.closest(KEYED_CONTROLS) !== null,
    },
    [run, root],
  );

  return (
    <div
      ref={ref}
      tabIndex={-1}
      data-ui="RunKeys"
      className="flex min-h-0 flex-1 flex-col outline-none"
    >
      {children}
    </div>
  );
}
