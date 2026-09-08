import { useVirtualizer } from "@tanstack/react-virtual";
import { Fragment, type ReactNode, useCallback, useLayoutEffect, useRef, useState } from "react";

import { scrollerOf } from "@/hooks";
import { gridClass } from "@/modules/library/utils";

/** Rows to keep mounted past each edge, so a fast scroll lands on drawn cards. */
const OVERSCAN = 3;

/** What a row is worth before anything has been measured. */
const ESTIMATED_ROW_PX = 240;

interface VirtualCardsProps<T> {
  items: readonly T[];
  keyOf: (item: T) => string;
  viewMode: "grid" | "list";
  renderItem: (item: T) => ReactNode;
  /** The element a reorder animation measures its cards inside. */
  containerRef?: React.Ref<HTMLDivElement>;
  className?: string;
}

/**
 * A list's cards, mounting only the rows the reader can see.
 *
 * The column count is read back out of the row's own computed
 * `grid-template-columns` rather than worked out from the card width, so the
 * browser's `auto-fill` answer is the one used and the zoom and card-scale
 * tokens need no second implementation here.
 */
export function VirtualCards<T>({
  items,
  keyOf,
  viewMode,
  renderItem,
  containerRef,
  className = "",
}: VirtualCardsProps<T>) {
  const frameRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [columns, setColumns] = useState(1);
  const [rowGap, setRowGap] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    if (frameRef.current) setScroller(scrollerOf(frameRef.current));
  }, []);

  /* The row is the grid, so its used track list is the column count and its own
     row gap is the space between rows the absolute layout has to add back. The
     margin is whatever sits between the scroller's top and the first row - the
     scroller's padding, and a folder header where there is one. */
  const measure = useCallback(() => {
    const frame = frameRef.current;
    if (frame && scroller) {
      const top = frame.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      setScrollMargin(top + scroller.scrollTop);
    }

    const row = rowRef.current;
    if (!row) return;

    const style = getComputedStyle(row);
    const tracks = style.gridTemplateColumns;
    setColumns(tracks === "none" ? 1 : tracks.split(" ").length);
    setRowGap(Number.parseFloat(style.rowGap) || 0);
  }, [scroller]);

  useLayoutEffect(() => {
    measure();
    if (!scroller) return;

    const observer = new ResizeObserver(measure);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [measure, scroller]);

  const rowCount = Math.ceil(items.length / columns);
  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => scroller,
    estimateSize: () => ESTIMATED_ROW_PX + rowGap,
    overscan: OVERSCAN,
    scrollMargin,
  });

  return (
    <div
      ref={frameRef}
      className={className}
      style={{ height: virtualizer.getTotalSize(), position: "relative" }}
      data-ui="VirtualCards"
    >
      <div ref={containerRef}>
        {virtualizer.getVirtualItems().map((row) => {
          const from = row.index * columns;
          const slice = items.slice(from, from + columns);

          return (
            <div
              key={row.key}
              ref={(node) => {
                if (row.index === 0) rowRef.current = node;
                virtualizer.measureElement(node);
              }}
              data-index={row.index}
              className={gridClass(viewMode)}
              style={{
                position: "absolute",
                insetInline: 0,
                top: 0,
                transform: `translateY(${row.start - scrollMargin}px)`,
                paddingBottom: rowGap,
              }}
            >
              {slice.map((item) => (
                <Fragment key={keyOf(item)}>{renderItem(item)}</Fragment>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
