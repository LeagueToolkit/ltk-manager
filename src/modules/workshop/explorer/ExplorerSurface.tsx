import { useVirtualizer } from "@tanstack/react-virtual";
import type {
  CSSProperties,
  HTMLAttributes,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react";
import { useCallback, useEffect, useState } from "react";

import { ContextMenu } from "@/components";
import { NO_OVERSCROLL } from "@/hooks/useOverscrollSpring";
import { twMerge } from "@/utils";

import { stirImages } from "../preview/useImageSlot";
import { gridStep } from "../utils/gridNav";
import type { ExplorerFileItem, ExplorerItem } from "./items";
import type { ExplorerSelectionApi } from "./useExplorer";

/** What a row carries, including the debug and hit-test data attributes. */
export type ExplorerRowAttributes = HTMLAttributes<HTMLDivElement> & {
  [key: `data-${string}`]: string | number | boolean | undefined;
};

export interface ExplorerSurfaceProps {
  items: readonly ExplorerItem[];
  /** Owned by the caller, which measures it to decide the geometry below. */
  scrollRef: RefObject<HTMLDivElement | null>;
  /** How many items one row draws. A details list draws one. */
  columns: number;
  /** Every row's height in px, which the zoom has already been applied to. */
  rowHeight: number;
  selection: ExplorerSelectionApi;
  /** Names this surface's scroll, so a return to the tab lands where it was left. */
  ariaLabel: string;
  /** The view drawing here, which is what an inspected element resolves to. */
  dataUi: string;
  scrollClassName?: string;
  rowClassName?: string;
  rowStyle?: CSSProperties;
  /**
   * What a row carries when the row itself is the item, as it is in a list.
   *
   * A grid draws many items to a row and leaves this alone, so its tiles hold
   * the index and the selected state. A list draws one, and putting them on the
   * row is what lets three cells share one fill and one focus ring.
   */
  rowAttrs?: (
    items: readonly ExplorerItem[],
    from: number,
    focused: number,
  ) => ExplorerRowAttributes;
  /** Sits above the rows inside the same scroll, so the two share a width. */
  header?: ReactNode;
  /**
   * The header's height in px, which the rows start below.
   *
   * The virtualizer measures from the scroll's own top, so a header in the flow
   * above the rows has to be declared here or every scroll to a row lands one
   * header too high and the sticky header covers what it scrolled to.
   */
  headerHeight?: number;
  renderRow: (items: readonly ExplorerItem[], from: number, focused: number) => ReactNode;
  /** A double click on a directory, or `Enter` on one. */
  onDescend: (path: string) => void;
  onOpen: (item: ExplorerFileItem) => void;
  /** The parent of the location, which `Backspace` and `Alt+↑` go to. */
  onUp: () => void;
  /**
   * What a right click offers, aimed at the item it opened on.
   *
   * The menu acts on the selection, which the right click has already aimed at
   * that item unless the selection held it. `null` is a click on the surface's
   * own background.
   */
  renderMenu?: (item: ExplorerItem | null) => ReactNode;
  /** `Ctrl+E` and `Ctrl+I`, the ways out the tree row offers on the same keys. */
  onRun?: (how: "quick" | "dialog" | "copy") => void;
}

/**
 * One directory as virtualized rows, whatever a row is drawn as.
 *
 * The grid and the details list differ in what one row holds and in nothing
 * else, so the scroll, the virtualizer, the keys, the hit testing and the menu
 * live here and each view supplies a `renderRow`. A second implementation of
 * these is a second keyboard model that drifts from the first.
 */
export function ExplorerSurface({
  items,
  scrollRef,
  columns,
  rowHeight,
  selection,
  ariaLabel,
  dataUi,
  scrollClassName,
  rowClassName,
  rowStyle,
  rowAttrs,
  header,
  headerHeight = 0,
  renderRow,
  onDescend,
  onOpen,
  onUp,
  renderMenu,
  onRun,
}: ExplorerSurfaceProps) {
  const rows = Math.ceil(items.length / columns);

  const [focused, setFocused] = useState(0);
  const [aimed, setAimed] = useState<ExplorerItem | null>(null);

  useEffect(() => {
    setFocused((at) => (items.length === 0 ? 0 : Math.min(at, items.length - 1)));
  }, [items.length]);

  const virtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
    /* One row beyond the viewport, which is the row whose items ask for their
       thumbnails before the scroll reaches them. */
    overscan: 1,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, rowHeight]);

  const focusItem = useCallback(
    (index: number) => {
      setFocused(index);
      virtualizer.scrollToIndex(Math.floor(index / columns), { align: "auto" });
      requestAnimationFrame(() => {
        scrollRef.current?.querySelector<HTMLElement>(`[data-item-index="${index}"]`)?.focus();
      });
    },
    [virtualizer, columns, scrollRef],
  );

  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const item = items[focused];

      if (event.ctrlKey || event.metaKey) {
        const key = event.key.toLowerCase();
        if (key === "a") {
          event.preventDefault();
          selection.selectAll();
          return;
        }
        if (onRun && key === "e") {
          event.preventDefault();
          onRun(event.shiftKey ? "dialog" : "quick");
          return;
        }
        if (onRun && key === "i") {
          event.preventDefault();
          onRun("copy");
          return;
        }
        if (key === " ") {
          event.preventDefault();
          if (item) selection.select(item.id, { toggle: true, extend: false });
          return;
        }
      }

      if (event.key === "Escape") {
        event.preventDefault();
        selection.clear();
        return;
      }

      if (event.key === "Backspace") {
        event.preventDefault();
        onUp();
        return;
      }

      if (event.key === "Enter" && item) {
        event.preventDefault();
        if (item.kind === "dir") onDescend(item.id);
        else onOpen(item);
        return;
      }

      /* `Alt` with an arrow belongs to the navigation history and to the move
         to a parent, so the focus does not also step on those. */
      const stepped = event.altKey
        ? null
        : gridStep(event.key, { index: focused, count: items.length, columns });
      if (stepped !== null) {
        event.preventDefault();
        focusItem(stepped);
        const landed = items[stepped];
        if (landed && event.shiftKey) selection.select(landed.id, { toggle: false, extend: true });
        return;
      }

      /* A letter jumps to the next name starting with it, the way a file
         manager does. Wrapped, so the last match leads back to the first. */
      if (event.key.length === 1 && /^[a-z0-9]$/i.test(event.key)) {
        const jumped = nextStartingWith(items, focused, event.key.toLowerCase());
        if (jumped !== null) {
          event.preventDefault();
          focusItem(jumped);
        }
      }
    },
    [items, focused, columns, selection, onRun, onUp, onDescend, onOpen, focusItem],
  );

  const handleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const index = itemIndexOf(event.target);
      if (index === null) return;
      const item = items[index];
      if (!item) return;

      setFocused(index);
      selection.select(item.id, {
        toggle: event.ctrlKey || event.metaKey,
        extend: event.shiftKey,
      });
    },
    [items, selection],
  );

  const handleDoubleClick = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const index = itemIndexOf(event.target);
      const item = index === null ? undefined : items[index];
      if (!item) return;

      if (item.kind === "dir") onDescend(item.id);
      else onOpen(item);
    },
    [items, onDescend, onOpen],
  );

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      const index = itemIndexOf(event.target);
      const item = index === null ? null : (items[index] ?? null);
      setAimed(item);
      if (index === null || !item) return;

      setFocused(index);
      selection.aimAt(item.id);
    },
    [items, selection],
  );

  const body = (
    <div
      data-ui={dataUi}
      ref={scrollRef}
      role="grid"
      aria-label={ariaLabel}
      aria-multiselectable
      tabIndex={-1}
      className={twMerge(
        "flex-1 overflow-auto outline-none scrollbar-md scrollbar-track",
        scrollClassName,
      )}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onScroll={stirImages}
      {...NO_OVERSCROLL}
    >
      {header}
      <div
        role="presentation"
        className="relative w-full"
        style={{ height: `${virtualizer.getTotalSize()}px` }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const from = virtualRow.index * columns;
          const row = items.slice(from, from + columns);
          const { className, ...attrs } = rowAttrs?.(row, from, focused) ?? {};

          return (
            <div
              key={virtualRow.key}
              {...attrs}
              role="row"
              className={twMerge("absolute inset-x-0", rowClassName, className)}
              style={{
                transform: `translateY(${virtualRow.start - headerHeight}px)`,
                height: `${rowHeight}px`,
                ...rowStyle,
              }}
            >
              {renderRow(row, from, focused)}
            </div>
          );
        })}
      </div>
    </div>
  );

  if (!renderMenu) return body;

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger render={body} />
      {renderMenu(aimed)}
    </ContextMenu.Root>
  );
}

/** An element's measured width in px, and zero until it has been observed. */
export function useMeasuredWidth(ref: RefObject<HTMLElement | null>): number {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries.at(-1);
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref]);

  return width;
}

/**
 * The item a pointer event landed in, and null for the surface's background.
 *
 * `Element` rather than `HTMLElement`, because an item's glyph is an `<svg>` and
 * an SVG node is neither an `HTMLElement` nor a descendant of one in the type
 * sense. Guarding on the narrower type drops every click that lands on the
 * artwork, which is most of a tile.
 */
export function itemIndexOf(target: EventTarget | null): number | null {
  if (!(target instanceof Element)) return null;
  const item = target.closest<HTMLElement>("[data-item-index]");
  const index = Number(item?.dataset.itemIndex);
  return Number.isInteger(index) ? index : null;
}

function nextStartingWith(
  items: readonly ExplorerItem[],
  from: number,
  letter: string,
): number | null {
  for (let step = 1; step <= items.length; step += 1) {
    const at = (from + step) % items.length;
    if (items[at]?.name.toLowerCase().startsWith(letter)) return at;
  }
  return null;
}
