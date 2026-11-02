import { twMerge } from "@/utils";

import type { EmissionPeriod } from "../../engine/model/model";

/** How many cycles the strip draws. */
const CYCLES = 2;

/**
 * Two cycles of an emitter's period as a strip: the active part lit, the pause dark, and a
 * notch where the second cycle opens, as the timeline's bars draw them.
 *
 * Draws nothing for a period with no length, since there is no cycle to repeat. An active
 * part past the length lights the whole cycle. "Bursts and cycles are marked" in
 * docs/ux/BIN_EDITOR.md.
 */
export function CycleStrip({ period, className }: { period: EmissionPeriod; className?: string }) {
  if (period.length === null || !(period.length > 0)) return null;

  const lit = Math.min(Math.max((period.active ?? period.length) / period.length, 0), 1);
  const cycle = `${100 / CYCLES}%`;

  return (
    /* DS-RADIUS: the strip is dense inline chrome. */
    <span
      aria-hidden
      data-ui="CycleStrip"
      className={twMerge(
        "relative flex h-1.5 w-14 shrink-0 overflow-hidden rounded-sm bg-surface-700",
        className,
      )}
    >
      {Array.from({ length: CYCLES }, (_, at) => (
        <span key={at} className="relative h-full shrink-0" style={{ width: cycle }}>
          <span
            className="absolute inset-y-0 left-0 bg-accent-500"
            style={{ width: `${lit * 100}%` }}
          />
          {at > 0 && <span className="absolute inset-y-0 left-0 w-px bg-accent-300" />}
        </span>
      ))}
    </span>
  );
}
