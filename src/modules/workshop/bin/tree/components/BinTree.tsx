import {
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ContextMenu } from "@/components";
import { NO_OVERSCROLL } from "@/hooks";
import type { AssetRef, BinDocumentId, BinRow, Dependency } from "@/lib/tauri";
import { twMerge } from "@/utils";

import type { OpenIntent } from "../../../palette/utils/types";
import { stirImages } from "../../../preview/hooks/useImageSlot";
import { assetKey } from "../../../preview/utils/assetRef";
import { isCollapseAllKey } from "../../../shared/utils/treeGestures";
import { rowTag } from "../../values/utils/kindTag";
import type { TreeFocus } from "../hooks/useBinEdit";
import { type TreeReveal, useReveal } from "../hooks/useReveal";
import { useRowWindow } from "../hooks/useRowWindow";
import { useTreeNavigation } from "../hooks/useTreeNavigation";
import { useNextPages, useTreeRows } from "../hooks/useTreeRows";
import { type DependencyEditing, DependencyEditingContext } from "../state/dependencyEditing";
import { NewObjectContext } from "../state/newObject";
import { useReshapes } from "../state/reshapes";
import { createGuideStore, GuideStoreContext } from "../state/treeGuides";
import {
  addLineKey,
  childCount,
  DEPENDENCIES_KEY,
  type InsertAt,
  lineParent,
  NEW_OBJECT_KEY,
  nameColumns,
  rowKey,
  type VisibleRow,
} from "../utils/binRows";
import { AddItemLine } from "./AddItemLine";
import { AddPropertyLine } from "./AddPropertyLine";
import { BinContextMenu } from "./BinContextMenu";
import { BinRowLine, MoreRow } from "./BinRow";
import { DependencyMenu } from "./DependencyMenu";
import { DependenciesRow, DependencyAddLine, DependencyRow } from "./DependencyRows";
import { NewObjectLine } from "./NewObjectLine";
import { TreeContexts } from "./TreeContexts";

export type { TreeReveal } from "../hooks/useReveal";

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
  /** The leaves take edits. A class view's section and a read-only document leave it off. */
  editable?: boolean;
  /** The object the roots are properties of, whose add line follows them. */
  rootEntry?: string | null;
  /** The header's dependencies, pinned over a file's roots. Null where the tree pins none. */
  dependencies?: readonly Dependency[] | null;
  /** A count the header's dependencies button raises, which opens and scrolls to that row. */
  dependenciesReveal?: number;
  /** A count the header's collapse-all button raises, which collapses every open row. */
  collapseAllSignal?: number;
}

const NO_KEYS: readonly string[] = [];

/** The room a bounded tree leaves around its rows, which is the scroller's own padding. */
const SCROLLER_PADDING = 8;

/** Whether `target` takes typed text, where `Ctrl+←` moves the caret by a word. */
function isTextEntry(target: EventTarget): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || target.closest("input, textarea, select") !== null;
}

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
  editable = false,
  rootEntry = null,
  dependencies = null,
  dependenciesReveal = 0,
  collapseAllSignal = 0,
}: BinTreeProps) {
  /* The one insert line open inside a list or a map. */
  const [insertAt, setInsertAt] = useState<InsertAt | null>(null);
  const newObject = use(NewObjectContext)?.draft ?? null;
  const {
    visible,
    loaded,
    groups,
    toggle: toggleRow,
    collapseAll: collapseRows,
    expand,
    requestMore,
    reach,
    remap,
  } = useTreeRows({
    document,
    roots,
    rootOwner,
    initialExpanded,
    onNotOpen,
    editable,
    rootEntry,
    insertAt,
    newObject,
    dependencies,
  });

  useReshapes(assetKey(asset), remap);

  const scrollRef = useRef<HTMLDivElement>(null);
  const { items, lines, totalSize, rowHeight, measureElement, scrollToKey } = useRowWindow(
    scrollRef,
    visible,
  );
  useNextPages(lines, requestMore);

  const { focused, clearFocus } = useReveal(reveal, {
    roots,
    loaded,
    expand,
    requestMore,
    scrollToKey,
  });
  const toggle = useCallback(
    (key: string) => {
      clearFocus();
      toggleRow(key);
    },
    [clearFocus, toggleRow],
  );

  const collapseAll = useCallback(() => {
    clearFocus();
    collapseRows();
  }, [clearFocus, collapseRows]);

  const collapsedFor = useRef(collapseAllSignal);
  useEffect(() => {
    if (collapseAllSignal === collapsedFor.current) return;
    collapsedFor.current = collapseAllSignal;
    collapseAll();
  }, [collapseAllSignal, collapseAll]);

  /* The row value or the add line an edit sends focus to, once it draws. */
  const [focusKey, setFocusKey] = useState<string | null>(null);

  const navigation = useTreeNavigation({
    visible,
    scrollRef,
    scrollToKey,
    drawn: items,
    toggle,
    editValue: editable ? setFocusKey : null,
  });

  function handleKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (navigation.keyDown(event)) {
      event.preventDefault();
      return;
    }
    if (!isCollapseAllKey(event) || isTextEntry(event.target)) return;

    event.preventDefault();
    collapseAll();
  }
  const focus = useMemo<TreeFocus>(
    () => ({
      key: focusKey,
      settle: () => setFocusKey(null),
      addTo: (row: BinRow) => {
        const key = rowKey(row);
        expand([key]);
        reach(key, childCount(row));
        setFocusKey(addLineKey(key));
      },
      to: (key: string, opening: string | null) => {
        if (opening !== null) expand([opening]);
        setFocusKey(key);
      },
      insertAt: (holder: string, index: number) => {
        setInsertAt({ holder, index });
        setFocusKey(addLineKey(holder, index));
      },
      closeInsert: () => setInsertAt(null),
      reach,
      remap,
    }),
    [expand, focusKey, reach, remap],
  );
  useEffect(() => {
    if (focusKey !== null && visible.some((line) => line.key === focusKey)) scrollToKey(focusKey);
  }, [focusKey, scrollToKey, visible]);

  /* A new object's line draws after every object, so it is scrolled to once per draft. */
  const scrolledDraft = useRef<typeof newObject>(null);
  useEffect(() => {
    if (newObject === null || scrolledDraft.current === newObject) return;
    if (!visible.some((line) => line.key === NEW_OBJECT_KEY)) return;
    scrolledDraft.current = newObject;
    scrollToKey(NEW_OBJECT_KEY);
  }, [newObject, scrollToKey, visible]);

  /* The pinned row is always drawn, so the reveal scrolls at once. Keyed on the count, so
     each press of the header's button reveals again. */
  const revealedDependencies = useRef(0);
  useEffect(() => {
    if (dependenciesReveal === revealedDependencies.current) return;
    revealedDependencies.current = dependenciesReveal;
    expand([DEPENDENCIES_KEY]);
    scrollToKey(DEPENDENCIES_KEY);
    requestAnimationFrame(() =>
      scrollRef.current?.querySelector<HTMLElement>("[data-dependencies-row]")?.focus(),
    );
  }, [dependenciesReveal, expand, scrollToKey]);

  const [editingDependency, setEditingDependency] = useState<number | null>(null);
  const dependencyEditing = useMemo<DependencyEditing>(
    () => ({ index: editingDependency, start: setEditingDependency }),
    [editingDependency],
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
  function lineAt(target: EventTarget): VisibleRow | null {
    const wrapper = (target as HTMLElement).closest<HTMLElement>("[data-index]");
    const index = Number(wrapper?.dataset.index);
    return Number.isInteger(index) ? (visible[index] ?? null) : null;
  }
  function handleContextMenu(event: ReactMouseEvent<HTMLElement>) {
    setMenuLine(lineAt(event.target));
  }

  /* Outside React state, so a pointer crossing the rows redraws the guides and nothing else. */
  const [guides] = useState(createGuideStore);
  function showGuidesAt(target: EventTarget) {
    const line = lineAt(target);
    if (line !== null) guides.set({ active: lineParent(line) });
  }
  useEffect(() => {
    const line = visible.find((candidate) => candidate.key === focused);
    if (line !== undefined) guides.set({ active: lineParent(line) });
  }, [focused, guides, visible]);

  return (
    <TreeContexts
      document={document}
      asset={asset}
      groups={groups}
      inView={inView}
      objectName={objectName}
      editable={editable}
      focus={focus}
    >
      <DependencyEditingContext value={dependencyEditing}>
        <GuideStoreContext value={guides}>
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
                  maxHeight:
                    maxRows === undefined ? undefined : rowHeight * maxRows + SCROLLER_PADDING,
                } as CSSProperties
              }
              onContextMenu={handleContextMenu}
              onKeyDown={handleKeyDown}
              onPointerDown={(event) => showGuidesAt(event.target)}
              onFocus={(event) => {
                showGuidesAt(event.target);
                navigation.focused(event.target);
              }}
              onMouseOver={(event) => {
                const line = lineAt(event.target);
                guides.set({ hover: line === null ? null : lineParent(line) });
              }}
              onMouseLeave={() => guides.set({ hover: null })}
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
                          tabStop={line.key === navigation.tabStop}
                          error={loaded.get(line.key)?.error}
                          onToggle={toggle}
                          onOpenObject={onOpenObject}
                        />
                      )}
                      {line.kind === "more" && <MoreRow line={line} />}
                      {line.kind === "dependencies" && (
                        <DependenciesRow line={line} onToggle={toggle} />
                      )}
                      {line.kind === "dependency" && <DependencyRow line={line} />}
                      {line.kind === "add" && line.target.kind === "dependency" && (
                        <DependencyAddLine line={line} autoFocus={line.key === focusKey} />
                      )}
                      {line.kind === "add" && line.target.kind === "property" && (
                        <AddPropertyLine line={line} autoFocus={line.key === focusKey} />
                      )}
                      {line.kind === "add" &&
                        line.target.kind !== "property" &&
                        line.target.kind !== "object" &&
                        line.target.kind !== "dependency" && (
                          <AddItemLine line={line} autoFocus={line.key === focusKey} />
                        )}
                      {line.kind === "add" && line.target.kind === "object" && (
                        <NewObjectLine line={line} draft={line.target.draft} />
                      )}
                    </div>
                  );
                })}
              </div>
            </ContextMenu.Trigger>

            <BinContextMenu line={menuLine} objectName={objectName} onOpenObject={onOpenObject} />
            <DependencyMenu line={menuLine} />
          </ContextMenu.Root>
        </GuideStoreContext>
      </DependencyEditingContext>
    </TreeContexts>
  );
}
