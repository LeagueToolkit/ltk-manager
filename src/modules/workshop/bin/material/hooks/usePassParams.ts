import { useMemo } from "react";

import type { BinRow } from "@/lib/tauri";

import type { LayoutPages, ViewContext } from "../../classes/components/ClassCells";
import { type ReadRequest, useBinRead } from "../../documents/hooks/useBinRead";
import { childCount, fieldHash, PAGE_SIZE, rowKey } from "../../tree/utils/binRows";
import { entriesByName, PARAM_FIELD, PARAM_VALUES, passPath } from "../utils/passPaths";

/** One pass of the drawn technique, and the `paramValues` entries it holds of its own. */
export interface PassList {
  /** The pass's place in the technique. */
  readonly index: number;
  /** The pass's wire path, which an edit of its entries is held under. */
  readonly holder: string;
  /** The pass's `paramValues` row, null where the pass holds none. */
  readonly list: BinRow | null;
  /** The pass's entries, the first of each name. */
  readonly entries: ReadonlyMap<string, BinRow>;
}

export interface PassParams {
  /** Every pass of the technique, in draw order, once the read of its fields answered. */
  readonly passes: readonly PassList[];
  /** What the reads answered, which the pass tables' cells read their fields out of. */
  readonly pages: LayoutPages;
}

const NO_REQUESTS: readonly ReadRequest[] = [];

/**
 * The `paramValues` of every pass of the technique at `technique`, read three levels down: each
 * pass's fields, each list, then each entry's fields. Null until the passes' fields answer.
 *
 * "Pass values" in docs/ux/BIN_EDITOR.md.
 */
export function usePassParams(
  view: ViewContext,
  technique: number | null,
  count: number,
): PassParams | null {
  const { document, entry } = view;
  const holders = useMemo(
    () =>
      technique === null
        ? []
        : Array.from({ length: count }, (_, index) => passPath(technique, index)),
    [technique, count],
  );

  const passPages = useBinRead(
    document,
    useMemo(
      () => holders.map((holder) => ({ key: `${entry}:${holder}`, rows: PAGE_SIZE })),
      [entry, holders],
    ),
  );
  const lists = useMemo(
    () =>
      holders.map(
        (holder) =>
          passPages
            .get(`${entry}:${holder}`)
            ?.rows.find((row) => fieldHash(row.path) === PARAM_VALUES) ?? null,
      ),
    [entry, holders, passPages],
  );

  const listPages = useBinRead(
    document,
    useMemo(
      () =>
        lists.flatMap((list) =>
          list === null ? [] : [{ key: rowKey(list), rows: childCount(list) }],
        ),
      [lists],
    ),
  );
  const elements = useMemo(
    () => lists.map((list) => (list === null ? [] : (listPages.get(rowKey(list))?.rows ?? []))),
    [lists, listPages],
  );

  const elementPages = useBinRead(
    document,
    useMemo(() => {
      const requests = elements
        .flat()
        .map((element) => ({ key: rowKey(element), rows: childCount(element) }));
      return requests.length === 0 ? NO_REQUESTS : requests;
    }, [elements]),
  );

  return useMemo(() => {
    if (technique === null) return null;
    if (holders.some((holder) => !passPages.has(`${entry}:${holder}`))) return null;

    const pages: LayoutPages = new Map([...passPages, ...listPages, ...elementPages]);
    const passes = holders.map((holder, index): PassList => ({
      index,
      holder,
      list: lists[index] ?? null,
      entries: entriesByName(elements[index] ?? [], pages, PARAM_FIELD.name),
    }));
    return { passes, pages };
  }, [technique, holders, entry, passPages, listPages, elementPages, lists, elements]);
}
