import { XIcon } from "@phosphor-icons/react";
import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  useRef,
  useState,
} from "react";

import { m } from "@/i18n";
import { twMerge } from "@/utils";

import type { LoopRange } from "../../../../state";
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
} from "../utils/laneModel";

/** How far a pointer moves on the ruler before a press is a drag rather than a click, in pixels. */
const DRAG_SLOP = 4;

interface RulerProps {
  view: TimeWindow;
  width: number;
  /** Seconds one run lasts, which a dragged loop stays inside. */
  span: number;
  loop: LoopRange | null;
  onSeek: (x: number) => void;
  /** Pause the clock while a drag scrubs. */
  onScrubStart: () => void;
  /** Let the clock run again once the scrub ends. */
  onScrubEnd: () => void;
  onLoop: (loop: LoopRange | null) => void;
  onRefit: () => void;
}

/**
 * The ruler: ticks over the view, the loop band, and the gestures that scrub, loop and refit.
 *
 * A drag on the open ruler scrubs from the press, and Shift and a drag draws a new loop. A
 * drag on the band's edge or its body moves the in, the out or the whole range, and a click
 * on the band seeks. A double click inside the band or on its x clears it, and a double
 * click elsewhere refits the view.
 */
export function Ruler({
  view,
  width,
  span,
  loop,
  onSeek,
  onScrubStart,
  onScrubEnd,
  onLoop,
  onRefit,
}: RulerProps) {
  const press = useRef<{ x: number; grip: LoopGrip; dragging: boolean } | null>(null);
  const scrubbing = useRef(false);
  const [draft, setDraft] = useState<LoopRange | null>(null);
  /* Shift is down under the pointer, so a press draws a loop wherever it lands. */
  const [drawing, setDrawing] = useState(false);
  const shown = draft ?? loop;
  const labelled = ticks(view, width);

  const at = (event: ReactMouseEvent<HTMLDivElement>) =>
    event.clientX - event.currentTarget.getBoundingClientRect().left;

  const letGo = (event: ReactPointerEvent<HTMLDivElement>) => {
    const pressed = press.current;
    press.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    if (scrubbing.current) {
      scrubbing.current = false;
      onScrubEnd();
    }
    setDraft(null);
    return pressed;
  };

  return (
    <div
      role="group"
      aria-label={m.workshop_bin_timeline_ruler_label()}
      title={m.workshop_bin_timeline_ruler_hint()}
      className={twMerge(
        "relative h-full w-full select-none",
        drawing ? "cursor-crosshair" : "cursor-ew-resize",
      )}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        setDrawing(event.shiftKey);
        const x = at(event);
        const grip = event.shiftKey ? "ruler" : gripAt(loop, view, width, x);
        if (grip !== "ruler" || event.shiftKey) {
          press.current = { x, grip, dragging: false };
          return;
        }

        /* The second press of a double click is the double click's, which refits. */
        if (event.detail >= 2) return;
        scrubbing.current = true;
        onScrubStart();
        onSeek(x);
      }}
      onPointerMove={(event) => {
        setDrawing(event.shiftKey);
        const x = at(event);
        if (scrubbing.current) {
          onSeek(x);
          return;
        }

        const pressed = press.current;
        if (pressed === null) return;
        if (!pressed.dragging && Math.abs(x - pressed.x) < DRAG_SLOP) return;
        pressed.dragging = true;
        if (pressed.grip === "ruler" || loop === null) {
          const [from, to] = [timeAt(view, width, pressed.x), timeAt(view, width, x)].sort(
            (a, b) => a - b,
          );
          setDraft({ from: Math.max(from, 0), to });
          return;
        }
        const moved = timeAt(view, width, x) - timeAt(view, width, pressed.x);
        setDraft(draggedLoop(pressed.grip, loop, moved, span));
      }}
      onPointerUp={(event) => {
        const pressed = letGo(event);
        if (pressed === null) return;
        if (pressed.dragging && draft !== null) onLoop(draft);
        /* The second press of a double click is the double click's, which refits or clears. */
        else if (event.detail < 2) onSeek(pressed.x);
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
          className={twMerge(
            "absolute inset-y-0 border-x border-accent-500 bg-accent-500/20",
            drawing ? "cursor-crosshair" : "cursor-grab active:cursor-grabbing",
          )}
          style={{
            left: xOf(view, width, shown.from),
            width: Math.max(xOf(view, width, shown.to) - xOf(view, width, shown.from), 1),
          }}
        >
          <LoopHandle side="left" drawing={drawing} />
          <LoopHandle side="right" drawing={drawing} />
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
function LoopHandle({ side, drawing }: { side: "left" | "right"; drawing: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={twMerge(
        "absolute inset-y-0",
        drawing ? "cursor-crosshair" : "cursor-ew-resize hover:bg-accent-500/40",
      )}
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
