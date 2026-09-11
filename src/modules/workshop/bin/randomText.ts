import { m } from "@/i18n";

import { channelName } from "./curveChannels";
import { type ChannelDraw, type DrawSummary, isRandom, spread } from "./randomDraw";
import type { ValueFamily, ValueRange } from "./valueRows";

/** What stands between a range's two ends, the inspector's own. */
const RANGE_SEPARATOR = "..";

/** Significant digits a readout keeps. */
const READOUT_DIGITS = 4;

/** A number as a readout draws it. */
export function readout(value: number): string {
  return String(Number(value.toPrecision(READOUT_DIGITS)));
}

/** A range as one string, or its one end where both ends meet. */
export function rangeText(range: ValueRange): string {
  if (range.least === range.most) return readout(range.least);
  return `${readout(range.least)} ${RANGE_SEPARATOR} ${readout(range.most)}`;
}

/** A channel's ranges as one string, which a split writes as two. */
export function rangesText(ranges: readonly ValueRange[]): string {
  const [first, second] = ranges;
  if (first === undefined) return "";
  if (second === undefined) return rangeText(first);
  return m.workshop_bin_random_or_label({ first: rangeText(first), second: rangeText(second) });
}

/** What a channel draws: its result where the base holds still, else its factor. */
export function drawnText(draw: ChannelDraw): string {
  if (draw.results !== null) return rangesText(draw.results);
  return m.workshop_bin_random_times_label({ range: rangesText(draw.factors) });
}

/** What a channel draws over `level`, or its factor where the level is not one number. */
export function drawnOver(draw: ChannelDraw, level: number | null): string {
  if (draw.shape === "broken") return "";
  if (level !== null) return rangesText(draw.factors.map((range) => spread(level, range)));
  if (!isRandom(draw.shape)) return "";
  return m.workshop_bin_random_times_label({ range: rangesText(draw.factors) });
}

/** The factor under a result, which names the base it multiplies. */
export function factorText(draw: ChannelDraw): string {
  const range = rangesText(draw.factors);
  if (draw.base === null) return m.workshop_bin_random_factor_curve_label({ range });
  return m.workshop_bin_random_factor_label({ range, base: readout(draw.base) });
}

/** The word a channel's row names its draw by. */
export function shapeText(draw: ChannelDraw): string {
  switch (draw.shape) {
    case "fixed":
      return m.workshop_bin_random_fixed_label();
    case "always":
      return m.workshop_bin_random_always_label({ factor: readout(draw.factors[0]?.least ?? 1) });
    case "uniform":
      return m.workshop_bin_random_uniform_label();
    case "split":
      return m.workshop_bin_random_split_label();
    case "custom":
      return m.workshop_bin_random_custom_label();
    case "dead":
      return m.workshop_bin_random_dead_label();
    case "broken":
      if (draw.table === null) return m.workshop_bin_random_missing_label();
      return m.workshop_bin_random_mismatched_label();
  }
}

/**
 * The line a row carries for `summary`.
 *
 * A `ranged` row already draws the range in its value column, so the line names the shape.
 * Anywhere else it carries the range itself.
 */
export function summaryText(summary: DrawSummary, family: ValueFamily, ranged: boolean): string {
  switch (summary.kind) {
    case "broken":
      return m.workshop_bin_random_broken_label();
    case "several":
      return m.workshop_bin_random_several_label({ count: summary.count });
    case "linked": {
      if (ranged) return m.workshop_bin_random_linked_label();
      const names = summary.channels.map((channel) => channelName(family, channel)).join("");
      return `${names} ${drawnText(summary.draw)}`;
    }
    case "one": {
      const told = ranged ? shapeText(summary.draw) : drawnText(summary.draw);
      if (family === "scalar") return told;
      return `${channelName(family, summary.draw.channel)} ${told}`;
    }
  }
}
