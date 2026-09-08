import { CopyIcon } from "@phosphor-icons/react";
import { useMemo, useState } from "react";
import { twMerge } from "tailwind-merge";

import { useCopyToClipboard } from "@/hooks";
import { m } from "@/i18n";

import { CHECKERBOARD } from "../preview/ImagePreview";
import { Swatch } from "./ColorMark";
import { axisText } from "./curvePlot";
import {
  colorHex,
  type ColorStop,
  colorStops,
  type CurveKey,
  gradientCss,
  placeTime,
  type TimeSpan,
  timeSpan,
} from "./valueRows";

interface StopsProps {
  stops: readonly ColorStop[];
  span: TimeSpan;
  /** The stop the readout and the rail are on, an index into `stops`. */
  selected: number;
}

/**
 * A colour curve as the ramp it runs through. "The three tabs" in docs/ux/BIN_EDITOR.md.
 *
 * The band, a handle per stop on the axis under it, and the picked stop's own numbers over
 * it. Four channel lines are what a colour is made of rather than what it looks like, so a
 * colour plots none of them and the ramp is the whole reading.
 */
export function GradientPlot({ keys }: { keys: readonly CurveKey[] }) {
  const stops = useMemo(() => colorStops(keys), [keys]);
  const [picked, setPicked] = useState(0);
  const span = timeSpan(stops.map((stop) => stop.time));

  return (
    <div data-ui="GradientPlot" className="flex min-h-0 flex-1 flex-col justify-center gap-1">
      {/* The rail hangs off the band, so the two are one object with no gap between them. */}
      <div className="flex shrink-0 flex-col">
        <Band stops={stops} />
        <StopRail stops={stops} span={span} selected={picked} onSelect={setPicked} />
      </div>
      {stops.length > 0 && (
        <span className="flex justify-between text-meta text-surface-500">
          <span>{axisText(span.first)}</span>
          <span>{axisText(span.last)}</span>
        </span>
      )}
      <StopReadout stops={stops} span={span} selected={picked} />
    </div>
  );
}

/**
 * The stops as one bar, its alpha over a checkerboard.
 *
 * A bar of fixed height rather than one filling the pane: a ramp says the same thing at any
 * height, so the room belongs to whatever the reader opens the dock taller for.
 */
function Band({ stops }: { stops: readonly ColorStop[] }) {
  return (
    <span
      role="img"
      aria-label={m.workshop_bin_gradient_label({ count: stops.length })}
      /* DS-TOKEN, DS-VEIL, DS-RADIUS */
      className={`block h-6 shrink-0 overflow-hidden rounded-sm border border-surface-veil-strong ${CHECKERBOARD} [background-size:8px_8px]`}
    >
      <span className="block h-full w-full" style={{ background: gradientCss(stops) }} />
    </span>
  );
}

/**
 * One marker per stop, hanging off the band at the stop's own time.
 *
 * A marker points at the band rather than floating under it, so it reads as a stop of that
 * ramp and not as a chip beside one. Its body carries the colour it lands on, which is what
 * tells two stops of one ramp apart at this size.
 */
function StopRail({
  stops,
  span,
  selected,
  onSelect,
}: StopsProps & { onSelect: (at: number) => void }) {
  return (
    <span data-ui="StopRail" className="relative h-4 min-w-0">
      {stops.map((stop, at) => (
        <button
          key={at}
          type="button"
          aria-label={m.workshop_bin_gradient_stop_label({
            time: stop.time.toFixed(3),
            color: colorHex(stop.rgba),
          })}
          aria-pressed={at === selected}
          className="group/stop absolute top-0 flex -translate-x-1/2 cursor-pointer flex-col items-center"
          style={{ left: `${(placeTime(stop.time, span) * 100).toFixed(2)}%` }}
          onClick={() => onSelect(at)}
        >
          <Tip selected={at === selected} />
          {/* DS-HOVER */}
          <Swatch
            rgba={stop.rgba}
            className={twMerge(
              "h-3 w-3",
              at === selected ? "border-accent-500" : "group-hover/stop:border-accent-hover",
            )}
          />
        </button>
      ))}
    </span>
  );
}

/** The marker's point, drawn as a border triangle so it lands on the band's own edge. */
function Tip({ selected }: { selected: boolean }) {
  return (
    <span
      aria-hidden
      className={twMerge(
        "h-0 w-0 border-x-4 border-b-4 border-x-transparent",
        selected ? "border-b-accent-500" : "border-b-surface-500",
      )}
    />
  );
}

/** The stop the rail is on: when it lands, what colour it is, and the copy of that. */
function StopReadout({ stops, selected }: StopsProps) {
  const copy = useCopyToClipboard();
  const stop = stops[selected];
  if (stop === undefined) return null;

  const hex = colorHex(stop.rgba);
  return (
    <div data-ui="StopReadout" className="flex items-center gap-2 px-1 text-meta">
      <Swatch rgba={stop.rgba} />
      <span className="font-mono text-code text-surface-400 tabular-nums select-text">
        {stop.time.toFixed(3)}
      </span>
      <button
        type="button"
        aria-label={m.workshop_bin_copy_value_action()}
        /* DS-RADIUS, DS-VEIL */
        className="flex cursor-pointer items-center gap-1 rounded-sm px-1 font-mono text-code text-surface-200 hover:bg-surface-veil"
        onClick={() => void copy(hex, m.workshop_bin_value_label())}
      >
        {hex}
        <CopyIcon weight="bold" className="h-3 w-3 shrink-0 text-surface-400" />
      </button>
      <span className="ml-auto text-surface-500">
        {m.workshop_bin_gradient_label({ count: stops.length })}
      </span>
    </div>
  );
}
