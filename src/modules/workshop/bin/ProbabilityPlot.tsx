import { useState } from "react";

import { useResizeObserver } from "@/hooks";
import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { channelName, CHIP, STROKE } from "./curveChannels";
import { axisText, plotOf } from "./curvePlot";
import type { ProbabilityTable, ValueFamily } from "./valueRows";

/** How much room over and under the keys the value axis keeps, as a share of their span. */
const MARGIN = 0.12;

/** The room the value axis labels take, which the time axis keeps clear to line up under. */
const AXIS = "w-12";

/**
 * A channel's `probabilityTables` entry, plotted. "The three tabs" in docs/ux/BIN_EDITOR.md.
 *
 * What the game samples from one of these is documented nowhere the reversing reaches, so
 * the tab draws the lists the file holds and claims nothing about them. A colour has no
 * channel chips on its own graph, so the picker lives here rather than being shared.
 */
export function ProbabilityPlot({
  tables,
  family,
}: {
  tables: readonly ProbabilityTable[];
  family: ValueFamily;
}) {
  const [picked, setPicked] = useState(0);
  if (tables.length === 0) return <Empty />;

  /* A table the file dropped since the pick leaves the pick past the end. */
  const shown = Math.min(picked, tables.length - 1);
  const table = tables[shown];
  if (table === undefined) return <Empty />;

  return (
    <div data-ui="ProbabilityPlot" className="flex min-h-0 flex-1 flex-col gap-1">
      <TablePlot table={table} family={family} />
      <div className="flex gap-2">
        <span className={`shrink-0 ${AXIS}`} />
        <span className="flex min-w-0 flex-1 justify-center gap-1 text-meta">
          {tables.map((held, at) => (
            <button
              key={held.channel}
              type="button"
              /* DS-RADIUS, DS-VEIL, DS-TEXT */
              className={twMerge(
                "cursor-pointer rounded-sm px-1 hover:bg-surface-veil",
                at === shown ? (CHIP[held.channel] ?? CHIP[0]) : "text-surface-600",
              )}
              aria-pressed={at === shown}
              onClick={() => setPicked(at)}
            >
              {channelName(family, held.channel)}
            </button>
          ))}
        </span>
      </div>
    </div>
  );
}

/** One table: its keys plotted, or the one number it is worth where it holds none. */
function TablePlot({ table, family }: { table: ProbabilityTable; family: ValueFamily }) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const measure = useResizeObserver<HTMLDivElement>((element) =>
    setSize({ width: element.clientWidth, height: element.clientHeight }),
  );

  const plot = plotOf(table.keys, { width: size.width, height: size.height, margin: MARGIN });
  const hue = STROKE[table.channel] ?? STROKE[0];

  if (table.keys.length === 0) return <Single table={table} family={family} />;

  return (
    <div className="flex min-h-0 flex-1 gap-2">
      <span
        className={`flex shrink-0 flex-col justify-between text-right text-meta text-surface-500 ${AXIS}`}
      >
        <span>{plot === null ? "" : axisText(plot.high)}</span>
        <span>{plot === null ? "" : axisText(plot.low)}</span>
      </span>
      <div ref={measure} className="relative min-h-0 min-w-0 flex-1">
        {plot !== null && (
          <svg
            role="img"
            aria-label={m.workshop_bin_probability_keys_label({ count: table.keys.length })}
            width={size.width}
            height={size.height}
            className={hue}
          >
            <polyline
              points={plot.lines[0] ?? ""}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinejoin="round"
            />
            {(plot.points[0] ?? []).map((point, at) => (
              <circle key={at} cx={point.x} cy={point.y} r={2.5} fill="currentColor" />
            ))}
          </svg>
        )}
      </div>
    </div>
  );
}

/** A table with no keys, which is one number rather than a plot of nothing. */
function Single({ table, family }: { table: ProbabilityTable; family: ValueFamily }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-0.5">
      <span className="font-mono text-surface-100 tabular-nums select-text">
        {String(Number(table.single.toFixed(4)))}
      </span>
      <span className="text-meta text-surface-500">
        {m.workshop_bin_probability_single_label({ channel: channelName(family, table.channel) })}
      </span>
    </div>
  );
}

function Empty() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center text-meta text-surface-500">
      {m.workshop_bin_probability_empty()}
    </div>
  );
}
