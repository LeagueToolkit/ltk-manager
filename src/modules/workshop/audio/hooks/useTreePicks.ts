import { useCallback, useMemo, useState } from "react";

import type { NodeTarget } from "../utils/nodeBatch";
import {
  keepDrawn,
  NO_SELECTION,
  type PickMode,
  pickedInOrder,
  pickRow,
  type RowSelection,
  selectAll,
} from "../utils/rowSelection";

/** The picked rows of a tree, and the presses and keys that change them. */
export interface TreePicks<T = NodeTarget> {
  /** The picked row keys. */
  readonly picked: ReadonlySet<string>;
  /** The objects of the picked rows, in the order that the tree draws them. */
  readonly targets: readonly T[];
  /** Moves the cursor to `key` and picks it under `mode`. */
  readonly pick: (key: string, mode: PickMode) => void;
  /** Picks every drawn row that stands for an object. */
  readonly pickAll: () => void;
  /** Clears the cursor and the selection. */
  readonly clear: () => void;
}

/**
 * Holds the picked rows of a tree whose rows `targets` stand for objects, in draw order.
 *
 * A pick of a row that stands for no object, such as a field, moves the cursor and clears the
 * picks. A pick that the tree no longer draws drops out. Per "Selection" in docs/ux/AUDIO.md.
 */
export function useTreePicks<T = NodeTarget>(
  targets: ReadonlyMap<string, T>,
  cursor: string | null,
  setCursor: (key: string | null) => void,
): TreePicks<T> {
  const [selection, setSelection] = useState<RowSelection>(NO_SELECTION);
  const order = useMemo(() => [...targets.keys()], [targets]);
  const shown = keepDrawn(selection, order);

  const pick = useCallback(
    (key: string, mode: PickMode) => {
      setCursor(key);
      if (!order.includes(key)) {
        setSelection(NO_SELECTION);
        return;
      }
      setSelection((current) => pickRow(keepDrawn(current, order), key, order, mode));
    },
    [order, setCursor],
  );

  const pickAll = useCallback(() => setSelection(selectAll(order, cursor)), [order, cursor]);

  const clear = useCallback(() => {
    setCursor(null);
    setSelection(NO_SELECTION);
  }, [setCursor]);

  const picked = pickedInOrder(shown, order).flatMap((key) => {
    const target = targets.get(key);
    return target === undefined ? [] : [target];
  });
  return { picked: shown.keys, targets: picked, pick, pickAll, clear };
}
