import { XIcon } from "@phosphor-icons/react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";

import { m } from "@/i18n";

import type { LoopRange } from "../../state";
import {
  draggedLoop,
  gripAt,
  LOOP_GRIP,
  type LoopGrip,
  minorTicks,
  ticks,
  timeAt,
  type TimeWindow,
  xOf,
} from "./laneModel";

/** How far a pointer moves on the ruler before a press is a drag rather than a seek, in pixels. */
const DRAG_SLOP = 4;

interface RulerProps {
  view: TimeWindow;
  width: number;
  /** Seconds one run lasts, which a dragged loop stays inside. */
  span: number;
  loop: LoopRange | null;
  onSeek: (x: number) => void;
  onLoop: (loop: LoopRange | null) => void;
  onRefit: () => void;
}

/**
 * The ruler: ticks over the view, the loop band, and the gestures that seek, loop and refit.
 *
 * A press seeks. A drag on the open ruler sets a new loop, and a drag on the band's edge or
 * its body moves the in, the out or the whole range. A double click inside the band or on
 * its x clears it, and a double click elsewhere refits the view.
 */
export function Ruler({ view, width, span, loop, onSeek, onLoop, onRefit }: RulerProps) {
  const press = useRef<{ x: number; grip: LoopGrip; dragging: boolean } | null>(null);
  const [draft, setDraft] = useState<LoopRange | null>(null);
  const shown = draft ?? loop;
  const labelled = ticks(view, width);

  const at = (event: ReactMouseEvent<HTMLDivElement>) =>
    event.clientX - event.currentTarget.getBoundingClientRect().left;

  const letGo = (event: ReactPointerEvent<HTMLDivElement>) => {
    const held = press.current;
    press.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDraft(null);
    return held;
  };

  return (
    <div
      role="group"
      aria-label={m.workshop_bin_timeline_ruler_label()}
      className="relative h-full w-full select-none"
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        const x = at(event);
        press.current = { x, grip: gripAt(loop, view, width, x), dragging: false };
      }}
      onPointerMove={(event) => {
        const held = press.current;
        if (held === null) return;
        const x = at(event);
        if (!held.dragging && Math.abs(x - held.x) < DRAG_SLOP) return;
        held.dragging = true;
        if (held.grip === "ruler" || loop === null) {
          const [from, to] = [timeAt(view, width, held.x), timeAt(view, width, x)].sort(
            (a, b) => a - b,
          );
          setDraft({ from: Math.max(from, 0), to });
          return;
        }
        const moved = timeAt(view, width, x) - timeAt(view, width, held.x);
        setDraft(draggedLoop(held.grip, loop, moved, span));
      }}
      onPointerUp={(event) => {
        const held = letGo(event);
        if (held === null) return;
        if (held.dragging && draft !== null) onLoop(draft);
        /* The second press of a double click is the double click's, which refits or clears. */
        else if (event.detail < 2) onSeek(held.x);
      }}
      onPointerCancel={letGo}
      onDoubleClick={(event) => {
        const time = timeAt(view, width, at(event));
        if (loop !== null && time >= loop.from && time <= loop.to) onLoop(null);
        else onRefit();
      }}
    >
      <PastRun x={xOf(view, width, span)} width={width} />
      {minorTicks(view, width).map((tick) => (
        <span
          key={tick}
          aria-hidden="true"
          className="absolute bottom-0 h-1 w-px bg-surface-700"
          style={{ left: xOf(view, width, tick) }}
        />
      ))}
      {labelled.map((tick, index) => (
        <Tick
          key={tick}
          x={xOf(view, width, tick)}
          time={tick}
          unit={index === labelled.length - 1}
        />
      ))}
      {shown !== null && (
        <span
          role="img"
          aria-label={m.workshop_bin_timeline_loop_label({
            from: shown.from.toFixed(2),
            to: shown.to.toFixed(2),
          })}
          className="absolute inset-y-0 cursor-grab border-x border-accent-500 bg-accent-500/20 active:cursor-grabbing"
          style={{
            left: xOf(view, width, shown.from),
            width: Math.max(xOf(view, width, shown.to) - xOf(view, width, shown.from), 1),
          }}
        >
          <LoopHandle side="left" />
          <LoopHandle side="right" />
          {draft === null && (
            <button
              type="button"
              aria-label={m.workshop_bin_timeline_loop_clear_action()}
              className="absolute top-0 flex h-full w-4 cursor-pointer items-center justify-center text-accent-300 hover:text-accent-100"
              style={{ right: LOOP_GRIP }}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => {
                event.stopPropagation();
                onLoop(null);
              }}
            >
              <XIcon weight="bold" className="h-3 w-3" />
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** The shade over whatever of the view lies past the run's end, from `x` to the edge. */
export function PastRun({ x, width }: { x: number; width: number }) {
  if (x >= width) return null;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-y-0 right-0 border-l border-surface-600 bg-surface-950/50"
      style={{ left: Math.max(x, 0) }}
    />
  );
}

/** The hit box over one edge of the loop band, as wide as the grip `gripAt` reads. */
function LoopHandle({ side }: { side: "left" | "right" }) {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 cursor-ew-resize hover:bg-accent-500/40"
      style={{ [side]: -LOOP_GRIP, width: LOOP_GRIP * 2 }}
    />
  );
}

/** One tick of the ruler and its label, in seconds, the last one naming the unit. */
function Tick({ x, time, unit }: { x: number; time: number; unit: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="absolute inset-y-0 flex items-end gap-0.5 font-mono text-meta text-code text-surface-500 tabular-nums"
      style={{ left: x }}
    >
      <span className="h-2 w-px bg-surface-600" />
      <span className="pb-px leading-none">
        {time}
        {unit && (
          <span className="ml-0.5 text-surface-600">
            {m.workshop_bin_inspector_unit_seconds_label()}
          </span>
        )}
      </span>
    </span>
  );
}
