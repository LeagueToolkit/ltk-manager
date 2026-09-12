import { useMemo } from "react";

import type { BinDocumentId, BinRow } from "@/lib/tauri";

import { rowKey, type RowLine } from "./binRows";
import type { LayoutPages } from "./ClassCells";
import { levelRequests, type PlacedSection, readsOwnMarks } from "./classLayouts";
import { useBinRead } from "./useBinRead";

const NO_PAGES: LayoutPages = new Map();

/** What the view holds a row for: the menu it aims, and the marks it reads. */
interface ViewRows {
  /** Every row a cell was drawn for, by key, which is what the menu is aimed at. */
  readonly menu: ReadonlyMap<string, BinRow>;
  /** The rows the view reads a value mark for, which a widget of its own is left out of. */
  readonly marks: readonly BinRow[];
}

/**
 * The levels a layout's widgets read, through the projected read.
 *
 * "What a layout reads" in docs/ux/BIN_EDITOR.md. The depth-zero rows arrive with the
 * open, so a material costs the containers and then their elements, two calls. A level
 * asks out of what the levels above it answered, and a tree section reads nothing until
 * a reader expands it.
 */
export function useLayoutRead(
  document: BinDocumentId,
  placed: readonly PlacedSection[],
): LayoutPages {
  const first = useBinRead(
    document,
    useMemo(() => levelRequests(placed, NO_PAGES, 0), [placed]),
  );
  const second = useBinRead(
    document,
    useMemo(() => levelRequests(placed, first, 1), [placed, first]),
  );
  const above = useMemo(() => joined(first, second), [first, second]);
  const third = useBinRead(
    document,
    useMemo(() => levelRequests(placed, above, 2), [placed, above]),
  );
  return useMemo(() => joined(above, third), [above, third]);
}

/** Two levels' answers as one map, which is how a level reads what the ones above it got. */
function joined(above: LayoutPages, level: LayoutPages): LayoutPages {
  if (level.size === 0) return above;
  return new Map([...above, ...level]);
}

/** Every row the layout drew a cell for, and which of them the view marks itself. */
export function cellRows(placed: readonly PlacedSection[], pages: LayoutPages): ViewRows {
  const menu = new Map<string, BinRow>();
  const marks: BinRow[] = [];

  for (const section of placed) {
    if (section.widget === "tree") continue;
    const own = readsOwnMarks(section.widget);
    for (const row of walk(section.rows, pages)) {
      menu.set(rowKey(row), row);
      if (!own) marks.push(row);
    }
  }
  return { menu, marks };
}

/** `rows` and everything the read answered under them, however deep it went. */
function walk(rows: readonly BinRow[], pages: LayoutPages): BinRow[] {
  const out: BinRow[] = [];
  for (const row of rows) {
    out.push(row);
    const page = pages.get(rowKey(row));
    if (page) out.push(...walk(page.rows, pages));
  }
  return out;
}

/** A cell as the row menu reads one. Its depth and its expansion are the tree's, not a cell's. */
export function cellLine(row: BinRow, classHash: string): RowLine {
  return {
    kind: "row",
    key: rowKey(row),
    row,
    depth: 0,
    expanded: false,
    loading: false,
    owner: row.node === "property" ? classHash : null,
  };
}
