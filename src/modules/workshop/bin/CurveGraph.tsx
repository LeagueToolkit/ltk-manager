import { useState } from "react";
import { twMerge } from "tailwind-merge";

import { useResizeObserver } from "@/hooks";
import { m } from "@/i18n";

import { axisText, plotOf } from "./curvePlot";
import { GradientPlot } from "./GradientPlot";
import type { CurveKey, ValueFamily } from "./valueRows";

/** How much room over and under the keys the value axis keeps, as a share of their span. */
const MARGIN = 0.12;

/** The room the value axis labels take, which the time axis keeps clear to line up under. */
const AXIS = "w-12";

/** What each channel of a family is called, in the letters both of Riot's editors use. */
const CHANNELS: Record<ValueFamily, readonly string[]> = {
  scalar: ["value"],
  vector: ["X", "Y", "Z"],
  color: ["R", "G", "B", "A"],
};

/** The hue each channel draws in, X red, Y green and Z blue as Riot draws them. DS-KIND-HUE. */
const STROKE = ["text-channel-1", "text-channel-2", "text-channel-3", "text-channel-4"];
const CHIP = [
  "text-channel-1-text",
  "text-channel-2-text",
  "text-channel-3-text",
  "text-channel-4-text",
];

/**
 * A curve as the surface its family reads on. "The curve panel" in docs/ux/BIN_EDITOR.md.
 *
 * A colour is a ramp and every other family is a plot of its channels, which are two
 * drawings rather than one drawing with a switch on it.
 */
export function CurveGraph({ keys, family }: { keys: readonly CurveKey[]; family: ValueFamily }) {
  if (family === "color") return <GradientPlot keys={keys} />;
  return <ChannelPlot keys={keys} family={family} />;
}

/** The keys plotted against time, one line per channel, with chips that mute one. */
function ChannelPlot({ keys, family }: { keys: readonly CurveKey[]; family: ValueFamily }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const measure = useResizeObserver<HTMLDivElement>((element) =>
    setSize({ width: element.clientWidth, height: element.clientHeight }),
  );
  const [muted, setMuted] = useState<ReadonlySet<number>>(() => new Set());

  const plot = plotOf(keys, { width: size.width, height: size.height, margin: MARGIN });
  const names = CHANNELS[family];
  const drawn = plot === null ? [] : plot.lines.map((_, at) => at).filter((at) => !muted.has(at));
  const axis = plot !== null && drawn.length > 0;

  function toggle(channel: number) {
    setMuted((held) => {
      const next = new Set(held);
      if (!next.delete(channel)) next.add(channel);
      return next;
    });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1">
      <div className="flex min-h-0 flex-1 gap-2">
        <span
          className={`flex shrink-0 flex-col justify-between text-right text-meta text-surface-500 ${AXIS}`}
        >
          <span>{axis ? axisText(plot.high) : ""}</span>
          <span>{axis ? axisText(plot.low) : ""}</span>
        </span>
        <div ref={measure} className="relative min-h-0 min-w-0 flex-1">
          {plot !== null && (
            <svg
              role="img"
              aria-label={m.workshop_bin_curve_keys_label({ count: keys.length })}
              width={size.width}
              height={size.height}
              className="relative"
            >
              {plot.at.map((x, at) => (
                <line
                  key={at}
                  x1={x}
                  x2={x}
                  y1={0}
                  y2={size.height}
                  className="stroke-surface-600"
                  strokeWidth={1}
                  strokeDasharray="2 3"
                />
              ))}
              {drawn.map((channel) => (
                <g key={channel} className={STROKE[channel] ?? STROKE[0]}>
                  <polyline
                    points={plot.lines[channel] ?? ""}
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinejoin="round"
                  />
                  {(plot.points[channel] ?? []).map((point, at) => (
                    <circle key={at} cx={point.x} cy={point.y} r={2.5} fill="currentColor" />
                  ))}
                </g>
              ))}
            </svg>
          )}
        </div>
      </div>
      <div className="flex gap-2">
        <span className={`shrink-0 ${AXIS}`} />
        <span className="flex min-w-0 flex-1 items-center gap-2 text-meta text-surface-500">
          <span>{plot === null ? "" : axisText(plot.first)}</span>
          <span className="flex flex-1 justify-center gap-1">
            {names.length > 1 &&
              plot?.lines.map((_, channel) => (
                <button
                  key={channel}
                  type="button"
                  /* DS-RADIUS, DS-VEIL, DS-TEXT */
                  className={twMerge(
                    "cursor-pointer rounded-sm px-1 hover:bg-surface-veil",
                    muted.has(channel) ? "text-surface-600" : (CHIP[channel] ?? CHIP[0]),
                  )}
                  aria-pressed={!muted.has(channel)}
                  onClick={() => toggle(channel)}
                >
                  {names[channel] ?? String(channel)}
                </button>
              ))}
          </span>
          <span>{plot === null ? "" : axisText(plot.last)}</span>
        </span>
      </div>
    </div>
  );
}
