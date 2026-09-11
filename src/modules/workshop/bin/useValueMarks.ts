import { createContext, use, useMemo, useRef } from "react";

import { useDebouncedValue } from "@/hooks";
import type { BinDocumentId, BinRow } from "@/lib/tauri";

import { rowKey } from "./binRows";
import { useBinRead } from "./useBinRead";
import {
  constantRequests,
  type CurveRead,
  dynamicsRequests,
  stopRequests,
  tableFieldRequests,
  tableKeyRequests,
  tableRequests,
  valueFamily,
  type ValueMark,
  valueMarks,
} from "./valueRows";

/** How long a scroll stands still before the rows it left in view are read. */
const SETTLE_MS = 180;

const NO_MARKS: ReadonlyMap<string, ValueMark> = new Map();
const NO_ROWS: readonly BinRow[] = [];

/** What the enclosing tree read for its value rows. A row outside one draws its class alone. */
export const ValueMarksContext = createContext<ReadonlyMap<string, ValueMark>>(NO_MARKS);

/**
 * What the row under `key` draws after its class, or undefined while nothing has
 * answered. A cell holding no row asks for none.
 */
export function useValueMark(key: string | undefined): ValueMark | undefined {
  const marks = use(ValueMarksContext);
  return key === undefined ? undefined : marks.get(key);
}

/**
 * The constant, and the curve `read` asks for, of every value-family row in `rows`.
 *
 * "A value family on its row" in docs/ux/BIN_EDITOR.md. Three levels of the projected
 * read answer a curve: the row's own children, the curve one of them points at, and the
 * curve's two lists. A curve read walks three more for the probability tables. Each level
 * knows how many rows the next costs, so no level guesses at the call's cap.
 */
export function useValueMarks(
  document: BinDocumentId,
  rows: readonly BinRow[],
  read: CurveRead = "bands",
): ReadonlyMap<string, ValueMark> {
  const settled = useSettled(rows);
  const constants = useBinRead(
    document,
    useMemo(() => constantRequests(settled), [settled]),
  );
  const dynamics = useBinRead(
    document,
    useMemo(() => dynamicsRequests(settled, constants, read), [settled, constants, read]),
  );
  const stops = useBinRead(
    document,
    useMemo(() => stopRequests(dynamics), [dynamics]),
  );
  const tables = useBinRead(
    document,
    useMemo(() => tableRequests(dynamics, read), [dynamics, read]),
  );
  const tableFields = useBinRead(
    document,
    useMemo(() => tableFieldRequests(tables), [tables]),
  );
  const tableKeys = useBinRead(
    document,
    useMemo(() => tableKeyRequests(tableFields), [tableFields]),
  );

  return useMemo(
    () => valueMarks(settled, { constants, dynamics, stops, tables, tableFields, tableKeys }),
    [settled, constants, dynamics, stops, tables, tableFields, tableKeys],
  );
}

/**
 * The value rows of `rows` as of the last moment the set stopped changing.
 *
 * A scroll changes what is in view every frame, and a call per frame is what the
 * projected read exists to avoid. Between settles the last set stands, so a row
 * already read keeps its mark and a row just scrolled in waits for the scroll to stop.
 */
function useSettled(rows: readonly BinRow[]): readonly BinRow[] {
  const family = rows.filter((row) => valueFamily(row.value) !== null);
  const signature = family.map((row) => rowKey(row)).join("\n");
  const settled = useDebouncedValue(signature, SETTLE_MS);

  /* Held with its signature, so a settled set keeps one identity across renders. */
  const held = useRef({ signature: "", rows: NO_ROWS });
  if (settled === signature && held.current.signature !== signature) {
    held.current = { signature, rows: family };
  }
  return held.current.rows;
}
