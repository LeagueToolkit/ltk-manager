import type { Histogram } from "./driver";
import { type TimeWindow, xOf } from "./laneModel";

/** What `emitter` holds live at the bin the run has reached. */
export function liveCount(histogram: Histogram, emitter: number): number {
  if (histogram.reached < 0) return 0;
  return histogram.counts(emitter)[histogram.reached] ?? 0;
}

/** Each lane's live count written into its span, off the clock rather than a render. */
export function writeCounts(root: HTMLElement | null, histogram: Histogram): void {
  if (root === null) return;
  for (const span of root.querySelectorAll<HTMLElement>("[data-count]")) {
    const text = String(liveCount(histogram, Number(span.dataset.count)));
    if (span.textContent !== text) span.textContent = text;
  }
}

/** How the lanes lie under the histogram canvas. */
export interface LaneLayout {
  /** The emitter each row draws, and null for a row the histogram leaves blank. */
  readonly lanes: readonly (number | null)[];
  /** One row's height in pixels. */
  readonly row: number;
  readonly view: TimeWindow;
  readonly width: number;
}

/**
 * The lanes' histogram onto `canvas`: each emitter's live count per bin across the view,
 * up to the bin the run has reached, one lane per row, each lane scaled to its own peak.
 */
export function drawHistogram(
  canvas: HTMLCanvasElement | null,
  colour: string,
  histogram: Histogram,
  { lanes, row, view, width }: LaneLayout,
): void {
  if (canvas === null || width <= 0) return;
  const context = canvas.getContext("2d");
  if (context === null) return;
  const scale = globalThis.devicePixelRatio || 1;
  const height = lanes.length * row;
  if (canvas.width !== width * scale || canvas.height !== height * scale) {
    canvas.width = width * scale;
    canvas.height = height * scale;
  }
  context.setTransform(scale, 0, 0, scale, 0, 0);
  context.clearRect(0, 0, width, height);
  context.fillStyle = colour;

  const first = Math.max(Math.floor(view.from / histogram.bin), 0);
  const last = Math.min(Math.ceil(view.to / histogram.bin), histogram.reached, histogram.bins - 1);
  if (last < first) return;

  lanes.forEach((emitter, index) => {
    if (emitter === null) return;
    const counts = histogram.counts(emitter);
    let peak = 1;
    for (let bin = first; bin <= last; bin += 1) peak = Math.max(peak, counts[bin]);

    const base = index * row + row - 3;
    const tallest = row - 8;
    let column = -1;
    let most = 0;
    const flush = () => {
      if (column < 0 || most === 0) return;
      const rise = (most / peak) * tallest;
      context.fillRect(column, base - rise, 1, rise);
    };
    for (let bin = first; bin <= last; bin += 1) {
      const x = Math.floor(xOf(view, width, bin * histogram.bin));
      if (x < 0 || x >= width) continue;
      if (x !== column) {
        flush();
        column = x;
        most = counts[bin];
      } else {
        most = Math.max(most, counts[bin]);
      }
    }
    flush();
  });
}
