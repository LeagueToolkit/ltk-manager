import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ContextMenu } from "@/components";
import { NO_OVERSCROLL, useZoomedPx } from "@/hooks";
import type { AssetRef, BinDocumentId, BinRow } from "@/lib/tauri";

import { useWarmObjectIndex } from "../gameBrowser";
import type { OpenIntent } from "../palette/types";
import { stirImages } from "../preview/useImageSlot";
import { useOpenDocumentAs } from "../state";
import { BinContextMenu } from "./BinContextMenu";
import { BinRowLine, MoreRow, ROW_HEIGHT } from "./BinRow";
import {
  flattenRows,
  isUnder,
  nameColumns,
  pagesWanted,
  rowKey,
  toggled,
  type VisibleRow,
} from "./binRows";
import { rowTag } from "./kindTag";
import { decideObjectLink } from "./linkDecision";
import { type ChildrenRequest, useBinChildren } from "./useBinDocument";
import {
  LinkAssetContext,
  type LinkOpen,
  LinkOpenContext,
  LinkTargetsContext,
  type RowGroup,
  useCheckLinkTargets,
} from "./useLinkTargets";
import { useValueMarks, ValueMarksContext } from "./useValueMarks";

/** A row the tree is asked to expand, focus and scroll to. A new token scrolls again. */
export interface TreeReveal {
  readonly key: string;
  readonly token: number;
}

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
  reveal?: TreeReveal | null;
  /** The name of the object an entry hash addresses, for the path a row copies. */
  objectName: (entry: string) => string;
  /** The backend holds no document with this id. The caller reopens it. */
  onNotOpen: () => void;
  /** Open the object a row declares, per the intent a click or a `Ctrl+click` carries. */
  onOpenObject?: (row: BinRow, intent: OpenIntent) => void;
}

const NO_KEYS: readonly string[] = [];

/**
 * The rows of one bin document as a tree, a window at a time.
 *
 * The tree stays in the backend (ADR-0026). This holds the expansion state, a window of
 * rows, and asks for the rows under one node at a time. The file tab and the object tab
 * draw it over their own roots.
 */
export function BinTree({
  document,
  asset,
  roots,
  rootOwner,
  label,
  initialExpanded = NO_KEYS,
  reveal = null,
  objectName,
  onNotOpen,
  onOpenObject,
}: BinTreeProps) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(initialExpanded));
  const [pages, setPages] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [focused, setFocused] = useState<string | null>(null);
  const [scrollTo, setScrollTo] = useState<TreeReveal | null>(null);

  const requests = useMemo<ChildrenRequest[]>(
    () => [...expanded].map((key) => ({ key, pages: pages.get(key) ?? 1 })),
    [expanded, pages],
  );
  const { loaded, notOpen } = useBinChildren(document, requests);

  useEffect(() => {
    if (notOpen) onNotOpen();
  }, [notOpen, onNotOpen]);

  const visible = useMemo(
    () => flattenRows(roots, expanded, (key) => loaded.get(key), rootOwner),
    [roots, expanded, loaded, rootOwner],
  );

  /* One width for the whole list, so the values stay in a column while no name elides
     that could have fitted. */
  const nameCols = useMemo(() => nameColumns(visible, rowTag), [visible]);

  /* The roots and every expanded node's rows, each checked as one group. */
  const groups = useMemo<RowGroup[]>(
    () => [
      { key: "", rows: roots },
      ...[...loaded].map(([key, children]) => ({ key, rows: children.rows })),
    ],
    [roots, loaded],
  );
  const linkTargets = useCheckLinkTargets(document, groups);

  /* A link clicked while the index is absent: the build runs, and the click lands on
     the answer. A target the answer lacks is forgotten. */
  const warm = useWarmObjectIndex();
  const open = useOpenDocumentAs();
  const [wanting, setWanting] = useState<ReadonlyMap<string, OpenIntent>>(() => new Map());
  const warmMutate = warm.mutate;
  const linkOpen = useMemo<LinkOpen>(
    () => ({
      wantOpen: (hash, intent) => {
        setWanting((current) => new Map(current).set(hash, intent));
        warmMutate();
      },
      wanting: new Set(wanting.keys()),
    }),
    [wanting, warmMutate],
  );
  useEffect(() => {
    if (linkTargets.index?.status !== "ready" && linkTargets.index?.status !== "failed") return;
    const settled = [...wanting].filter(([hash, intent]) => {
      const decision = decideObjectLink(hash, linkTargets);
      if (decision.kind === "chip") open(decision.document, intent);
      return decision.kind !== "pending" && decision.kind !== "warm";
    });
    if (settled.length === 0) return;
    setWanting((current) => {
      const next = new Map(current);
      for (const [hash] of settled) next.delete(hash);
      return next;
    });
  }, [linkTargets, open, wanting]);

  const toggle = useCallback((key: string) => {
    setFocused(null);
    setExpanded((current) => {
      if (!current.has(key)) return toggled(current, key);
      /* Collapsing forgets what was open underneath. Nothing hidden is fetched. */
      return new Set([...current].filter((open) => !isUnder(key, open)));
    });
  }, []);

  const requestMore = useCallback((parent: string, loadedCount: number) => {
    setPages((current) => {
      const wanted = pagesWanted(loadedCount);
      if ((current.get(parent) ?? 1) >= wanted) return current;
      return new Map(current).set(parent, wanted);
    });
  }, []);

  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomed = useZoomedPx();
  const virtualizer = useVirtualizer({
    count: visible.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => zoomed(ROW_HEIGHT),
    overscan: 16,
    getItemKey: (index) => visible[index]?.key ?? index,
  });

  /* Sizes cached at the old zoom outlive a change to it: `estimateSize` is not
     one of the inputs the measurement memo watches. */
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, zoomed]);

  const virtualItems = virtualizer.getVirtualItems();

  /* The viewport's own rows, which is the page a value row's read is scoped to. */
  const inView = useMemo(
    () =>
      virtualItems.flatMap((item) => {
        const line = visible[item.index];
        return line?.kind === "row" ? [line.row] : [];
      }),
    [virtualItems, visible],
  );
  const marks = useValueMarks(document, inView);

  /* A node's next page is asked for while the line under its rows is on screen. */
  useEffect(() => {
    for (const item of virtualItems) {
      const line = visible[item.index];
      if (line?.kind === "more" && !line.pending) requestMore(line.parent, line.loaded);
    }
  }, [virtualItems, visible, requestMore]);

  /* A request for a row that is not a root is left alone. */
  useEffect(() => {
    if (reveal === null || !roots.some((row) => rowKey(row) === reveal.key)) return;
    setExpanded((current) => (current.has(reveal.key) ? current : toggled(current, reveal.key)));
    setFocused(reveal.key);
    setScrollTo(reveal);
  }, [reveal, roots]);

  /* Keyed on the request's token. A second request for the same row scrolls again. */
  const scrolledToken = useRef<number | null>(null);
  useEffect(() => {
    if (scrollTo === null || scrolledToken.current === scrollTo.token) return;
    const index = visible.findIndex((line) => line.key === scrollTo.key);
    if (index < 0) return;
    scrolledToken.current = scrollTo.token;
    virtualizer.scrollToIndex(index, { align: "start" });
  }, [scrollTo, visible, virtualizer]);

  /* One menu for the whole list, pointed at the line the event came from. */
  const [menuLine, setMenuLine] = useState<VisibleRow | null>(null);
  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    const wrapper = (event.target as HTMLElement).closest<HTMLElement>("[data-index]");
    const index = Number(wrapper?.dataset.index);
    setMenuLine(Number.isInteger(index) ? (visible[index] ?? null) : null);
  }

  return (
    <LinkAssetContext value={asset}>
      <LinkTargetsContext value={linkTargets}>
        <LinkOpenContext value={linkOpen}>
          <ValueMarksContext value={marks}>
            <ContextMenu.Root>
              <ContextMenu.Trigger
                ref={scrollRef}
                role="tree"
                aria-label={label}
                className="min-h-0 flex-1 overflow-auto px-1 py-1 font-mono outline-none scrollbar-md select-none"
                style={{ "--bin-name-cols": nameCols } as CSSProperties}
                onContextMenu={handleContextMenu}
                onScroll={stirImages}
                {...NO_OVERSCROLL}
              >
                <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                  {virtualItems.map((item) => {
                    const line = visible[item.index];
                    if (!line) return null;
                    return (
                      <div
                        key={item.key}
                        ref={virtualizer.measureElement}
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
          </ValueMarksContext>
        </LinkOpenContext>
      </LinkTargetsContext>
    </LinkAssetContext>
  );
}
