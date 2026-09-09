/**
 * The one selection every view of an explorer draws.
 *
 * A tree, a grid and a details list are three drawings of one set of items, so
 * the set belongs to the explorer rather than to any of them. An id holds
 * across a sort, a filter and a view switch, which is what lets a selection
 * outlive all three.
 *
 * A selected directory is every file below it. That is the whole answer to
 * what a selection spanning depths means, and it holds in every view.
 */

import type { SourceEntry } from "../gameBrowser/sourceIndex";

/** What the selection remembers about an item, once the row that drew it is gone. */
export interface SelectedItem {
  /** A directory's path, or a file's path hash. */
  readonly id: string;
  readonly kind: "dir" | "file";
  /** The directory's path, or the file's resolved path. Null for an unnamed chunk. */
  readonly path: string | null;
  readonly name: string;
  /** The file's size. A directory reads 0 until the index totals one. */
  readonly sizeBytes: number;
  /** What a directory holds below it, and 1 for a file. */
  readonly fileCount: number;
  /** Files only: what a copy or an extract takes. */
  readonly entry?: SourceEntry;
}

/** The set, and where an extend runs from. */
export interface Selection {
  readonly items: ReadonlyMap<string, SelectedItem>;
  readonly anchor: string | null;
}

export const NO_SELECTION: Selection = { items: new Map(), anchor: null };

/** Which modifiers rode along with the click or the arrow. */
export interface SelectGesture {
  /** `Ctrl` or `Meta`: add one, or remove one. */
  readonly toggle: boolean;
  /** `Shift`: run from the anchor. */
  readonly extend: boolean;
}

/** What the bar reports at its right end. */
export interface SelectionSummary {
  readonly files: number;
  readonly sizeBytes: number;
  /**
   * Whether `sizeBytes` is the whole of it.
   *
   * False once a directory is in, because no source totals the bytes below one
   * yet, so the size covers the files alone.
   */
  readonly sizeIsWhole: boolean;
}

/**
 * The selection a click on `id` leaves, under the modifiers it carried.
 *
 * `order` is the items the view has on screen, in the order it walks them,
 * which is what "between" means for an extend. An anchor a filter has taken
 * away leaves the click selecting its one item, because a run to somewhere the
 * user cannot see is not what they asked for.
 */
export function selectItem(
  selection: Selection,
  order: readonly SelectedItem[],
  id: string,
  gesture: SelectGesture,
): Selection {
  const clicked = order.find((item) => item.id === id);
  if (!clicked) return selection;

  if (gesture.extend) {
    const from = selection.anchor === null ? -1 : order.findIndex((i) => i.id === selection.anchor);
    const to = order.findIndex((i) => i.id === id);
    if (from < 0) return { items: new Map([[id, clicked]]), anchor: id };

    const run = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    const items = gesture.toggle ? new Map(selection.items) : new Map<string, SelectedItem>();
    for (const item of run) items.set(item.id, item);
    /* The anchor stays put, so a second extend narrows the run rather than
       pinning it to where the first one ended. */
    return { items, anchor: selection.anchor };
  }

  if (gesture.toggle) {
    const items = new Map(selection.items);
    if (items.has(id)) items.delete(id);
    else items.set(id, clicked);
    return { items, anchor: id };
  }

  return { items: new Map([[id, clicked]]), anchor: id };
}

/** Everything the view has on screen, which is what `Ctrl+A` takes. */
export function selectEvery(order: readonly SelectedItem[]): Selection {
  return {
    items: new Map(order.map((item) => [item.id, item])),
    anchor: order[0]?.id ?? null,
  };
}

/** What the selection comes to, counting a covered file once. */
export function selectionSummary(selection: Selection): SelectionSummary {
  const dirs = selectedDirs(selection);

  let files = 0;
  let sizeBytes = 0;
  let sizeIsWhole = true;

  for (const item of selection.items.values()) {
    if (coveredBy(dirs, item.path)) continue;
    files += item.fileCount;
    if (item.kind === "file") sizeBytes += item.sizeBytes;
    else sizeIsWhole = false;
  }

  return { files, sizeBytes, sizeIsWhole };
}

/**
 * Whether a selected directory holds `path`, which is what the half fill draws.
 *
 * A chunk no hash table names has no path to sit under, so it is never
 * covered. The unnamed group is the one directory that holds it, and selecting
 * that group selects the chunk itself.
 */
export function isCovered(selection: Selection, path: string | null): boolean {
  return coveredBy(selectedDirs(selection), path);
}

function selectedDirs(selection: Selection): string[] {
  const out: string[] = [];
  for (const item of selection.items.values()) {
    if (item.kind === "dir" && item.path !== null) out.push(item.path);
  }
  return out;
}

/** Prefix on a segment boundary, so `a` never reaches into `ab`. */
function coveredBy(dirs: readonly string[], path: string | null): boolean {
  if (path === null) return false;
  return dirs.some((dir) => path !== dir && path.startsWith(`${dir}/`));
}
