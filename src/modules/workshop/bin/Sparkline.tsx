import { twMerge } from "@/utils";

import { plotOf } from "./curvePlot";
import type { CurveKey } from "./valueRows";

/** The box the line is plotted in, which the class below sizes on the row. */
const WIDTH = 40;
const HEIGHT = 14;

/**
 * A curve as the shape of its keys, one line per channel.
 *
 * "The curve panel" in docs/ux/BIN_EDITOR.md. It carries no axis and no number, because
 * it answers whether a value moves rather than what it is worth: the dock is where a
 * reader goes for the numbers. The channels share one colour at this size, where the
 * dock's graph tells them apart.
 */
export function Sparkline({
  keys,
  label,
  wide = false,
}: {
  keys: readonly CurveKey[];
  label: string;
  /** The line takes the rest of its band, as a field row's own line gives it. */
  wide?: boolean;
}) {
  const plot = plotOf(keys, { width: WIDTH, height: HEIGHT, margin: 0 });
  if (plot === null || plot.lines.length === 0) return null;

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      className={twMerge(
        "h-3.5 shrink-0 text-surface-400",
        wide ? "w-auto min-w-24 flex-1 shrink" : "w-10",
      )}
    >
      {plot.lines.map((points, at) => (
        <polyline
          key={at}
          points={points}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          strokeLinejoin="round"
          /* The box is stretched to the row, so a scaled stroke would be an ellipse. */
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}
