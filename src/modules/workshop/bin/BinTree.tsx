import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useMemo,
  useRef,
  useState,
} from "react";

import { ContextMenu } from "@/components";
import { NO_OVERSCROLL } from "@/hooks";
import type { AssetRef, BinDocumentId, BinRow } from "@/lib/tauri";
import { twMerge } from "@/utils";

import type { OpenIntent } from "../palette/types";
import { stirImages } from "../preview/useImageSlot";
import { BinContextMenu } from "./BinContextMenu";
import { BinRowLine, MoreRow } from "./BinRow";
import { nameColumns, type VisibleRow } from "./binRows";
import { rowTag } from "./kindTag";
import { TreeContexts } from "./TreeContexts";
import { type TreeReveal, useReveal } from "./useReveal";
import { useRowWindow } from "./useRowWindow";
import { useNextPages, useTreeRows } from "./useTreeRows";

export type { TreeReveal } from "./useReveal";

interface BinTreeProps {
  /** The open's id, which every children call carries. */
  document: BinDocumentId;
  /** What the document was read from, which the layer side of a `file` link looks in. */
  asset: AssetRef;
  /** The rows at depth zero: the objects of a file, or the properties of one object. */
  roots: readonly BinRow[];
  /** The class the roots are properties of. Null where the roots are objects. */
  rootOwner: string | null;
  /** The tree's accessible name. */
  label: string;
  /** The keys open at mount. */
  initialExpanded?: readonly string[];
  /**
   * The most rows the scroller shows before it scrolls.
   *
   * Unset, the tree fills its parent, which is what a whole pane of rows wants. A
   * class view's section sets one, so a section of three rows is three rows tall.
   */
  maxRows?: number;
  reveal?: TreeReveal | null;
  /** The name of the object an entry hash addresses, for the path a row copies. */
  objectName: (entry: string) => string;
  /** The backend holds no document with this id. The caller reopens it. */
  onNotOpen: () => void;
  /** Open the object a row declares, per the intent a click or a `Ctrl+click` carries. */
  onOpenObject?: (row: BinRow, intent: OpenIntent) => void;
}

const NO_KEYS: readonly string[] = [];

/** The room a bounded tree leaves around its rows, which is the scroller's own padding. */
const SCROLLER_PADDING = 8;

/**
 * The rows of one bin document as a tree, a window at a time.
 *
 * The tree stays in the backend (ADR-0026). `useTreeRows` holds the expansion state and
 * the lines it produces, and `useRowWindow` draws the ones on screen. The file tab and
 * the object tab draw this over their own roots.
 */
export function BinTree({
  document,
  asset,
  roots,
  rootOwner,
  label,
  initialExpanded = NO_KEYS,
  maxRows,
  reveal = null,
  objectName,
  onNotOpen,
  onOpenObject,
}: BinTreeProps) {
  const {
    visible,
    loaded,
    groups,
    toggle: toggleRow,
    expand,
    requestMore,
  } = useTreeRows({ document, roots, rootOwner, initialExpanded, onNotOpen });

  const scrollRef = useRef<HTMLDivElement>(null);
  const { items, lines, totalSize, rowHeight, measureElement, scrollToKey } = useRowWindow(
    scrollRef,
    visible,
  );
  useNextPages(lines, requestMore);

  const { focused, clearFocus } = useReveal(reveal, roots, expand, scrollToKey);
  const toggle = useCallback(
    (key: string) => {
      clearFocus();
      toggleRow(key);
    },
    [clearFocus, toggleRow],
  );

  const inView = useMemo(
    () => lines.flatMap((line) => (line.kind === "row" ? [line.row] : [])),
    [lines],
  );

  /* One width for the whole list, so the values stay in a column while no name elides
     that could have fitted. */
  const nameCols = useMemo(() => nameColumns(visible, rowTag), [visible]);

  /* One menu for the whole list, pointed at the line the event came from. */
  const [menuLine, setMenuLine] = useState<VisibleRow | null>(null);
  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const wrapper = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
    const index = Number(wrapper?.dataset.index);
    setMenuLine(Number.isInteger(index) ? (visible[index] ?? null) : null);
  }

  return (
    <TreeContexts document={document} asset={asset} groups={groups} inView={inView}>
      <ContextMenu.Root>
        <ContextMenu.Trigger
          ref={scrollRef}
          role="tree"
          aria-label={label}
          className={twMerge(
            "overflow-auto px-1 py-1 font-mono outline-none scrollbar-md select-none",
            maxRows === undefined && "min-h-0 flex-1",
          )}
          style={
            {
              "--bin-name-cols": nameCols,
              maxHeight: maxRows === undefined ? undefined : rowHeight * maxRows + SCROLLER_PADDING,
            } as CSSProperties
          }
          onContextMenu={handleContextMenu}
          onScroll={stirImages}
          {...NO_OVERSCROLL}
        >
          <div className="relative w-full" style={{ height: totalSize }}>
            {items.map((item) => {
              const line = visible[item.index];
              if (!line) return null;
              return (
                <div
                  key={item.key}
                  ref={measureElement}
                  data-index={item.index}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start}px)` }}
                >
                  {line.kind === "row" && (
                    <BinRowLine
                      line={line}
                      focused={line.key === focused}
                      error={loaded.get(line.key)?.error}
                      onToggle={toggle}
                      onOpenObject={onOpenObject}
                    />
                  )}
                  {line.kind === "more" && <MoreRow line={line} />}
                </div>
              );
            })}
          </div>
        </ContextMenu.Trigger>

        <BinContextMenu line={menuLine} objectName={objectName} onOpenObject={onOpenObject} />
      </ContextMenu.Root>
    </TreeContexts>
  );
}
