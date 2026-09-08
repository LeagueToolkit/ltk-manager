import { useVirtualizer, type VirtualItem } from "@tanstack/react-virtual";
import { type RefObject, useCallback, useEffect, useMemo } from "react";

import { useZoomedPx } from "@/hooks";

import { ROW_HEIGHT } from "./BinRow";
import type { VisibleRow } from "./binRows";

/** The lines of a tree that are on screen, and where each one sits. */
export interface RowWindow {
  /** The items to draw, each carrying its index and its offset. */
  readonly items: readonly VirtualItem[];
  /** The lines the items point at, in the same order. */
  readonly lines: readonly VisibleRow[];
  /** The height the whole list would take. */
  readonly totalSize: number;
  /** One row at the current zoom, which is what a bounded tree is sized in. */
  readonly rowHeight: number;
  /** The ref a drawn line takes, which reports its height back. */
  readonly measureElement: (node: Element | null) => void;
  /** Scroll a line to the top. False where the tree holds no such line. */
  readonly scrollToKey: (key: string) => boolean;
}

/**
 * A window over `visible`, measured row by row.
 *
 * A row is a line of text until it holds a value editor, so the heights are measured
 * rather than assumed and `ROW_HEIGHT` is only the estimate an unmeasured row takes.
 */
export function useRowWindow(
  scrollRef: RefObject<HTMLDivElement | null>,
  visible: readonly VisibleRow[],
): RowWindow {
  const zoomed = useZoomedPx();
  const rowHeight = zoomed(ROW_HEIGHT);

  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 16,
    getItemKey: (index) => visible[index]?.key ?? index,
  });

  /* Sizes cached at the old zoom outlive a change to it: `estimateSize` is not one of
     the inputs the measurement memo watches. Clearing them leaves every mounted row on
     the estimate, because the observer answers a resize and a clear is none, so the
     rows on screen are asked for their height again. */
  useEffect(() => {
    virtualizer.measure();
    for (const node of virtualizer.elementsCache.values()) {
      if (node.isConnected) virtualizer.measureElement(node);
    }
  }, [virtualizer, rowHeight]);

  const items = virtualizer.getVirtualItems();
  const lines = useMemo(() => items.flatMap((item) => visible[item.index] ?? []), [items, visible]);

  const scrollToKey = useCallback(
    (key: string) => {
      const index = visible.findIndex((line) => line.key === key);
      if (index < 0) return false;
      virtualizer.scrollToIndex(index, { align: "start" });
      return true;
    },
    [visible, virtualizer],
  );

  return {
    items,
    lines,
    totalSize: virtualizer.getTotalSize(),
    rowHeight,
    measureElement: virtualizer.measureElement,
    scrollToKey,
  };
}
