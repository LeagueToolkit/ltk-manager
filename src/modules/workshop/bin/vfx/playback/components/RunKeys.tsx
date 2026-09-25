import { type ReactNode, useEffect } from "react";
import { useHotkeys } from "react-hotkeys-hook";

import { useContentVisible } from "@/hooks";

import { useEmitters } from "../../inspector/state/emitterChoice";
import { chosenEmitter } from "../../timeline/utils/selection";
import { useVfxRun, type VfxRun } from "../state/run";
import { speedDetent } from "./Transport";

/** How many frames Shift and an arrow move, which is a tenth of a second. */
const SHIFT_FRAMES = 6;

/** Fields that take typing, where no run key acts. */
const EDITABLE =
  "input:not([type='range']), textarea, select, [role='textbox'], [role='searchbox'], [role='spinbutton'], [role='combobox']";

/** Controls whose keys are the arrows and Space, which the run's keys leave alone. */
const KEYED_CONTROLS =
  "[role='tab'], [role='menuitem'], [role='menuitemcheckbox'], [role='menuitemradio'], [role='option'], [role='radio']";

/** A slider, which keeps the keys that move it and passes every other key to the run. */
const SLIDER = "input[type='range'], [role='slider']";

/** The keys a slider moves by. */
const SLIDER_KEYS: ReadonlySet<string> = new Set([
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "Home",
  "End",
  "PageUp",
  "PageDown",
]);

/** What each key does to the run, "The keys" in docs/ux/BIN_EDITOR.md. Esc is the pane tree's. */
const KEYS: Record<string, (run: VfxRun, selected: number | null) => void> = {
  space: (run) => run.setPlaying(!run.playing),
  left: (run) => run.step(-1),
  right: (run) => run.step(1),
  "shift+left": (run) => run.step(-SHIFT_FRAMES),
  "shift+right": (run) => run.step(SHIFT_FRAMES),
  home: (run) => {
    run.restart();
    run.setPlaying(true);
  },
  end: (run) => run.seekEnd(),
  l: (run) => run.setLooping(!run.looping),
  f: (run) => run.requestFit(),
  s: (run, selected) => selected !== null && run.toggleSoloed(selected),
  m: (run, selected) => selected !== null && run.toggleMuted(selected),
  bracketleft: (run) => run.setSpeed(speedDetent(run.speed, -1)),
  bracketright: (run) => run.setSpeed(speedDetent(run.speed, 1)),
};

/**
 * The run's keys, live wherever focus is inside this box and outside an editable field.
 *
 * The box takes focus itself, so a click on bare pane ground arms them, and so does the
 * tab turning visible while no other control has focus.
 */
export function RunKeys({ children }: { children: ReactNode }) {
  const run = useVfxRun();
  const { root } = useEmitters();
  const visible = useContentVisible();

  const ref = useHotkeys<HTMLDivElement>(
    Object.keys(KEYS).join(", "),
    (_, handler) => KEYS[handler.hotkey]?.(run, chosenEmitter(run.system, root)),
    {
      preventDefault: true,
      enableOnFormTags: true,
      ignoreEventWhen: ignoredKey,
    },
    [run, root],
  );

  useEffect(() => {
    const box = ref.current;
    if (!visible || box === null || !focusIsFree(box)) return;

    box.focus({ preventScroll: true });
  }, [ref, visible]);

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

/** A key the focused control uses, which the run leaves to it. */
function ignoredKey(event: KeyboardEvent): boolean {
  const target = event.target;
  if (!(target instanceof Element)) return false;
  if (target.closest(EDITABLE) !== null || target.closest(KEYED_CONTROLS) !== null) return true;

  return target.closest(SLIDER) !== null && SLIDER_KEYS.has(event.key);
}

/**
 * No control outside `box` has focus: the page has none, or the selected tab that shows it does.
 *
 * A preview tab opened from the Objects grid or the content tree leaves their focus alone.
 */
function focusIsFree(box: HTMLElement): boolean {
  const active = box.ownerDocument.activeElement;
  if (active === null || active === box.ownerDocument.body) return true;
  if (box.contains(active)) return false;

  return active.getAttribute("role") === "tab" && active.getAttribute("aria-selected") === "true";
}
