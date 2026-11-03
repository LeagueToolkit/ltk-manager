import { type ReactNode, useEffect, useRef } from "react";

import { useContentVisible } from "@/hooks";
import { type KeyHandlers, useKeys } from "@/modules/keys";

import { useEmitters } from "../../inspector/state/emitterChoice";
import { useTimelineMarkers } from "../../timeline/hooks/useTimelineMarkers";
import { type RunKey, vfxCommand } from "../../utils/vfxKeys";
import { useVfxRun } from "../state/run";
import { RUN_ACTIONS, runSelection } from "../utils/runActions";

const RUN_KEYS = Object.keys(RUN_ACTIONS) as RunKey[];

/**
 * The run's keys, live wherever focus is inside this box and outside an editable field.
 *
 * The box takes focus itself, so a click on bare pane ground arms them, and so does the
 * tab turning visible while no other control has focus.
 */
export function RunKeys({ children }: { children: ReactNode }) {
  const run = useVfxRun();
  const { cards, root, selected } = useEmitters();
  const markers = useTimelineMarkers();
  const visible = useContentVisible();
  const ref = useRef<HTMLDivElement>(null);

  const handlers: KeyHandlers = Object.fromEntries(
    RUN_KEYS.map((name) => [
      vfxCommand(name),
      () => RUN_ACTIONS[name](run, runSelection(run.system, cards, root, selected), markers),
    ]),
  );
  useKeys("document:vfx", handlers, { ref });

  useEffect(() => {
    const box = ref.current;
    if (!visible || box === null || !focusIsFree(box)) return;

    box.focus({ preventScroll: true });
  }, [visible]);

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
