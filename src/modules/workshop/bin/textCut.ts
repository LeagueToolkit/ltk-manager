const ELLIPSIS = "…";

/** The fewest characters a fitted name column holds, so a short name still reads as a column. */
const NAME_FLOOR = 8;

/**
 * `text` cut in its middle to `fit` characters, an ellipsis standing in for what was cut.
 *
 * The middle, because a name's two ends are what tell it from its neighbours. A `null` fit
 * is a box not yet measured.
 */
export function cutText(text: string, fit: number | null): string {
  if (fit === null || text.length <= fit) return text;
  if (fit <= 0) return "";
  const kept = fit - 1;
  const head = Math.ceil(kept / 2);
  const tail = kept - head;
  return text.slice(0, head) + ELLIPSIS + (tail > 0 ? text.slice(-tail) : "");
}

/** The characters `box` pixels hold at `ch` pixels each, or null before either is measured. */
export function charsIn(box: number, ch: number): number | null {
  if (box <= 0 || ch <= 0) return null;
  return Math.floor(box / ch);
}

/** A path's folder, its last slash included, and the file name after it. */
export function splitPath(text: string): { folder: string; file: string } {
  const at = text.lastIndexOf("/") + 1;
  return { folder: text.slice(0, at), file: text.slice(at) };
}

/**
 * A mono name column's CSS width: the longest of `names` plus `extra` pixels, capped at `cap`.
 *
 * In `ch`, so the width resolves in the font of the element it is set on.
 */
export function nameColumn(names: readonly string[], extra: number, cap: string): string {
  const chars = names.reduce((most, name) => Math.max(most, name.length), NAME_FLOOR);
  return `min(calc(${chars}ch + ${extra}px), ${cap})`;
}
