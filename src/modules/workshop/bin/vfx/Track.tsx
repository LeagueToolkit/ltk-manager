import { CaretRightIcon } from "@phosphor-icons/react";
import { type PointerEvent as ReactPointerEvent, useRef } from "react";
import { twMerge } from "tailwind-merge";

import { Tooltip } from "@/components";
import { m } from "@/i18n";

import { type LaneBar, type TimeWindow, xOf } from "./laneModel";

/** How long a pointer rests on a bar before its times show, in milliseconds. */
const BAR_DELAY = 400;

interface TrackProps {
  label: string;
  view: TimeWindow;
  width: number;
  bars: readonly LaneBar[];
  dimmed: boolean;
  /** The room left at the lane's right edge, in pixels. */
  right: number;
  onSeek: (x: number) => void;
}

/** A lane's bars over the view, which a press or a drag seeks along. */
export function Track({ label, view, width, bars, dimmed, right, onSeek }: TrackProps) {
  const pressed = useRef(false);
  const at = (event: ReactPointerEvent<HTMLDivElement>) =>
    event.clientX - event.currentTarget.getBoundingClientRect().left;
  const letGo = (event: ReactPointerEvent<HTMLDivElement>) => {
    pressed.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <div
      data-track=""
      role="group"
      aria-label={label}
      className={twMerge("absolute inset-y-0 left-0 overflow-hidden", dimmed && "opacity-50")}
      style={{ right }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        pressed.current = true;
        onSeek(at(event));
      }}
      onPointerMove={(event) => {
        if (pressed.current) onSeek(at(event));
      }}
      onPointerUp={letGo}
      onPointerCancel={letGo}
    >
      {bars.map((bar, index) => (
        <Bar key={index} bar={bar} view={view} width={width} />
      ))}
    </div>
  );
}

/** One bar: the solid emission view, the faded particle tail and the hatched linger. */
function Bar({ bar, view, width }: { bar: LaneBar; view: TimeWindow; width: number }) {
  const left = xOf(view, width, bar.start);
  const endless = bar.end === null;
  const end = bar.end ?? view.to;
  const right = xOf(view, width, end);
  const tail = xOf(view, width, end + bar.tail);
  const linger = xOf(view, width, end + bar.tail + bar.linger);
  if (right < 0 || left > width) return null;

  return (
    <>
      <Tooltip content={<BarTimes bar={bar} />} delay={BAR_DELAY} side="top">
        <span
          className="absolute top-1.5 bottom-1.5 rounded-sm border border-accent-500/50 bg-accent-500/25"
          style={{ left, width: Math.max(right - left, 2) }}
        />
      </Tooltip>
      {endless && (
        <CaretRightIcon
          weight="bold"
          role="img"
          aria-label={m.workshop_bin_timeline_endless_label()}
          className="absolute top-1/2 h-3 w-3 -translate-y-1/2 text-accent-400"
          style={{ left: Math.min(right, width) - 12 }}
        />
      )}
      {!endless && bar.tail > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-2 bottom-2 bg-accent-500/10"
          style={{ left: right, width: Math.max(tail - right, 0) }}
        />
      )}
      {!endless && bar.linger > 0 && (
        <span
          aria-hidden="true"
          className="absolute top-2.5 bottom-2.5 bg-[repeating-linear-gradient(135deg,var(--color-accent-500)_0_1px,transparent_1px_4px)] opacity-30"
          style={{ left: tail, width: Math.max(linger - tail, 0) }}
        />
      )}
    </>
  );
}

/** When a bar emits, how long its particles live on, and where its linger ends, in seconds. */
function BarTimes({ bar }: { bar: LaneBar }) {
  const from = bar.start.toFixed(2);
  if (bar.end === null) {
    return <span className="text-meta">{m.workshop_bin_timeline_bar_endless_label({ from })}</span>;
  }
  const particles = bar.end + bar.tail;
  return (
    <span className="flex flex-col font-mono text-meta tabular-nums">
      <span>{m.workshop_bin_timeline_bar_emits_label({ from, to: bar.end.toFixed(2) })}</span>
      {bar.tail > 0 && (
        <span className="text-surface-300">
          {m.workshop_bin_timeline_bar_particles_label({ to: particles.toFixed(2) })}
        </span>
      )}
      {bar.linger > 0 && (
        <span className="text-surface-400">
          {m.workshop_bin_timeline_bar_linger_label({
            to: (particles + bar.linger).toFixed(2),
          })}
        </span>
      )}
    </span>
  );
}
