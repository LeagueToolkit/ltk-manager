import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ContextMenu } from "@/components";
import { useRemeasure, useZoomedPx } from "@/hooks";
import { m } from "@/i18n";
import { toggledIn } from "@/utils";

import { steppedRow, useActiveRow } from "../../../shared/hooks/useActiveRow";
import { instantScroll } from "../../../shared/utils/instantScroll";
import { isCollapseAllKey } from "../../../shared/utils/treeGestures";
import { Notice } from "../../shared/preview/Notice";
import { ROW_HEIGHT } from "../../tree/components/BinRow";
import { mapQueries } from "../api/mapQueries";
import { useGeometryMeshes } from "../hooks/useGeometryMeshes";
import { useMapCommands } from "../hooks/useMapCommands";
import { useMapEditKeys } from "../hooks/useMapEditKeys";
import { useMeshActions } from "../hooks/useMeshActions";
import { useOutlinerGuides } from "../hooks/useOutlinerGuides";
import { usePlaceableActions } from "../hooks/usePlaceableActions";
import { useMapScene } from "../state/mapScene";
import { filtering, isHidden, kindCounts, type OutlineFilter } from "../utils/mapOutline";
import { modeOf, type SelectMode } from "../utils/mapSelection";
import { meshIndexOf } from "../utils/meshSelection";
import { navCellOf } from "../utils/navCells";
import {
  groupId,
  OUTLINER_DRAG_TYPE,
  rowLevel,
  type SceneRow,
  sceneRows,
} from "../utils/sceneOutline";
import { OutlinerMenu } from "./OutlinerMenu";
import { OutlinerRow } from "./OutlinerRow";
import { OutlinerSearch } from "./OutlinerSearch";
import { SelectionBar } from "./SelectionBar";

const NONE: ReadonlySet<string> = new Set();

/**
 * A map's scene as a tree, as Maya's and Blender's outliners list one: the meshes of its
 * `.mapgeo` grouped by controller, and the chunks of its `.materials.bin` with what each holds.
 * The meshes are listed while the map takes edits.
 *
 * A search box narrows the tree to the meshes and placeables whose name, class, material or
 * controller holds the text, and a chip per kind keeps only that kind of placeable. An eye
 * hides an object or a chunk from the scene.
 *
 * The tree is one tab stop: Up and Down walk the rows, Right opens a row or steps into it,
 * Left closes it or steps out, Enter or Space acts on the row, and Ctrl+F returns to the box.
 * A click selects and Shift adds and Ctrl flips, the selection the viewport shares. The keys of
 * `MAP_KEYS` act as they do in the viewport, except End, which steps to the last row, and Ctrl+A,
 * which selects the rows on screen. A right click opens the row's actions, and a mesh or a
 * placeable drags onto a controller group or a chunk to move there. The rows are virtual, since one chunk of
 * Summoner's Rift holds a thousand.
 */
export function MapOutliner({ collapseAllSignal = 0 }: MapOutlinerProps) {
  const { materials, chosen, variants, failed, hidden, focus, focusOn } = useMapScene();
  const { filter, setFilter, selected, lead, select, backdrop } = useMapScene();
  const { guides, toggleEye } = useOutlinerGuides();
  const outline = useQuery(mapQueries.outline(materials));
  const chunks = outline.data;
  const geometry = useGeometryMeshes();
  const placeables = usePlaceableActions();
  const meshActions = useMeshActions(geometry.meshes.length);
  const editKeys = useMapEditKeys(placeables, geometry);
  const { runs } = useMapCommands(placeables, geometry.meshes, geometry.selection);
  const [opened, setOpened] = useState<ReadonlySet<string>>(NONE);
  /* The sections, and the groups and chunks under a filter, that the reader shut. */
  const [shut, setShut] = useState<ReadonlySet<string>>(NONE);
  const narrowed = filtering(filter);

  const controllerName = useCallback(
    (hash: string) =>
      backdrop.controllers.find((controller) => controller.hash === hash)?.name ?? hash,
    [backdrop.controllers],
  );
  const rows = useMemo(
    () =>
      sceneRows({
        meshes: geometry.meshes,
        chunks: chunks ?? [],
        filter,
        opened,
        shut,
        controllerName,
        guides,
      }),
    [geometry.meshes, chunks, filter, opened, shut, controllerName, guides],
  );
  const sectioned = rows[0]?.type === "section";
  const counts = useMemo(() => kindCounts(chunks ?? []), [chunks]);
  const matches = narrowed ? shownCount(rows) : null;

  const changeFilter = useCallback(
    (next: OutlineFilter) => {
      setFilter(next);
      setShut(NONE);
    },
    [setFilter],
  );

  const toggle = useCallback(
    (row: SceneRow) => {
      const flip = (held: ReadonlySet<string>) => toggledIn(held, row.id);
      if (row.type === "section" || narrowed) setShut(flip);
      else setOpened(flip);
    },
    [narrowed],
  );

  const collapseAll = useCallback(() => {
    if (narrowed) setShut(new Set(rows.filter(folds).map((row) => row.id)));
    else setOpened((current) => (current.size === 0 ? current : NONE));
  }, [narrowed, rows]);

  const collapsedFor = useRef(collapseAllSignal);
  useEffect(() => {
    if (collapseAllSignal === collapsedFor.current) return;
    collapsedFor.current = collapseAllSignal;
    collapseAll();
  }, [collapseAllSignal, collapseAll]);

  const scroller = useRef<HTMLDivElement>(null);
  const search = useRef<HTMLInputElement>(null);
  const zoomed = useZoomedPx();
  const rowHeight = zoomed(ROW_HEIGHT);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: () => rowHeight,
    overscan: 12,
    getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
    scrollToFn: instantScroll,
  });
  useRemeasure(virtualizer, rowHeight);

  const { active, setActiveId, stepTo, reveal, domId, activeDescendant, isActive } = useActiveRow(
    rows,
    virtualizer,
  );

  /* A pick made anywhere, the viewport included, opens what holds it and scrolls the tree to
     it once the row stands. */
  const revealed = useRef<string | null>(null);
  useEffect(() => {
    if (lead === null || lead === revealed.current || !selected.has(lead)) return;
    if (navCellOf(lead) !== null) return;
    revealed.current = lead;
    reveal(lead);

    const meshIndex = meshIndexOf(lead);
    const holders =
      meshIndex === null
        ? ["section:placeables", lead.slice(0, lead.indexOf("/"))]
        : [
            "section:meshes",
            groupId(geometry.meshes.find((mesh) => mesh.index === meshIndex)?.controller ?? null),
          ];
    setShut((held) => {
      if (!holders.some((id) => held.has(id))) return held;
      const next = new Set(held);
      for (const id of holders) next.delete(id);
      return next;
    });
    if (!narrowed) {
      setOpened((held) =>
        holders.every((id) => held.has(id)) ? held : new Set([...held, ...holders]),
      );
    }
  }, [lead, selected, narrowed, reveal, geometry.meshes]);

  const frame = useCallback(
    (row: SceneRow) => {
      if (row.type === "item") {
        focusOn({
          id: row.id,
          position: row.item.position as [number, number, number],
        });
      } else if (row.type === "mesh") {
        const { min, max } = row.mesh;
        const middle = (axis: number) => ((min[axis] ?? 0) + (max[axis] ?? 0)) / 2;
        focusOn({ id: row.id, position: [middle(0), middle(1), middle(2)] });
      }
    },
    [focusOn],
  );

  /* A plain pick selects the object alone and flies to it, and a modified one edits the
     selection in place. */
  const act = (row: SceneRow, mode: SelectMode = "replace") => {
    setActiveId(row.id);
    if (row.type !== "item" && row.type !== "mesh") {
      toggle(row);
      return;
    }
    select([row.id], mode);
    if (mode === "replace") frame(row);
  };

  const listed = () => rows.filter(selectable).map((row) => row.id);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const command = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (isCollapseAllKey(event)) {
      event.preventDefault();
      collapseAll();
      return;
    }
    if (command && key === "f") {
      event.preventDefault();
      search.current?.focus();
      search.current?.select();
      return;
    }
    if (command && key === "a") {
      event.preventDefault();
      select(listed(), "replace");
      return;
    }

    const row = rows[active];
    if (row !== undefined) {
      const page = virtualizer.getVirtualItems().length;
      const step = navigation(event.key, row, active, rows, page, sectioned);
      if (step !== null) {
        event.preventDefault();
        if (step === "act") act(row);
        else if (step === "toggle") toggle(row);
        else stepTo(step);
        return;
      }
    }

    editKeys(event);
  }

  /* One menu for the whole tree, pointed at the row the right click came from. */
  const [menuRow, setMenuRow] = useState<SceneRow | null>(null);
  function rowAt(target: EventTarget): SceneRow | null {
    const wrapper = (target as HTMLElement).closest<HTMLElement>("[data-index]");
    const index = Number(wrapper?.dataset.index);
    return Number.isInteger(index) ? (rows[index] ?? null) : null;
  }
  function handleContextMenu(event: MouseEvent<HTMLDivElement>) {
    const row = rowAt(event.target);
    setMenuRow(row);
    if (row !== null && selectable(row) && !selected.has(row.id)) select([row.id], "replace");
  }

  /* What a drag carries and the row it would drop onto. */
  const [dropOn, setDropOn] = useState<string | null>(null);
  const dragging = useRef<"mesh" | "item" | null>(null);
  const startDrag = (row: SceneRow) => (event: DragEvent) => {
    if (!selected.has(row.id)) select([row.id], "replace");
    dragging.current = row.type === "mesh" ? "mesh" : "item";
    event.dataTransfer.setData(OUTLINER_DRAG_TYPE, row.id);
    event.dataTransfer.effectAllowed = "move";
  };
  const takes = (row: SceneRow) =>
    (row.type === "chunk" && dragging.current === "item") ||
    (row.type === "group" && dragging.current === "mesh");
  const dragOver = (row: SceneRow) => (event: DragEvent) => {
    if (!takes(row)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropOn(row.id);
  };
  const drop = (row: SceneRow) => (event: DragEvent) => {
    event.preventDefault();
    setDropOn(null);
    dragging.current = null;
    if (row.type === "chunk") {
      void placeables.moveTo(row.chunk.entry);
    } else if (row.type === "group") {
      void meshActions.setController(
        geometry.selection.map((mesh) => mesh.index),
        row.controller,
      );
    }
  };

  if (failed || outline.error !== null) {
    return <Notice text={m.workshop_bin_map_preview_failed_empty()} />;
  }
  if (variants !== undefined && chosen === null) {
    return <Notice text={m.workshop_bin_map_preview_missing_empty()} />;
  }
  if (chunks === undefined) return <Notice text={m.workshop_bin_map_outliner_loading_label()} />;
  if (chunks.length === 0 && geometry.meshes.length === 0) {
    return <Notice text={m.workshop_bin_map_outliner_empty()} />;
  }

  return (
    <div data-ui="MapOutliner" className="flex min-h-0 flex-1 flex-col select-none">
      <OutlinerSearch
        filter={filter}
        onChange={changeFilter}
        counts={counts}
        meshCount={geometry.meshes.length}
        matches={matches}
        inputRef={search}
        onLeave={() => scroller.current?.focus()}
      />
      <SelectionBar onFrame={runs.frameSelection} />
      {rows.length === 0 && <Notice text={m.workshop_bin_map_outliner_no_match_empty()} />}
      <ContextMenu.Root>
        <ContextMenu.Trigger
          ref={scroller}
          role="tree"
          tabIndex={0}
          aria-label={m.workshop_bin_pane_outliner_label()}
          aria-activedescendant={activeDescendant}
          /* DS-SCROLLBAR */
          className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-1.5 text-row outline-none scrollbar-md"
          onKeyDown={handleKeyDown}
          onContextMenu={handleContextMenu}
          onDragEnd={() => {
            dragging.current = null;
            setDropOn(null);
          }}
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((virtual) => {
              const row = rows[virtual.index];
              if (row === undefined) return null;

              const rowIsHidden = rowHidden(row, hidden);
              const movable = selectable(row) && placeables.editable;
              return (
                <div
                  key={virtual.key}
                  data-index={virtual.index}
                  className="absolute top-0 left-0 w-full"
                  style={{
                    height: virtual.size,
                    transform: `translateY(${virtual.start}px)`,
                  }}
                >
                  <OutlinerRow
                    domId={domId(virtual.index)}
                    row={row}
                    level={rowLevel(row, sectioned)}
                    hidden={rowIsHidden}
                    focused={focus?.id === row.id}
                    selected={selected.has(row.id)}
                    active={isActive(virtual.index)}
                    query={filter.text}
                    narrowed={narrowed}
                    dropping={dropOn === row.id}
                    controllerName={controllerName}
                    onActivate={(event) => act(row, modeOf(event))}
                    onHide={() => toggleEye(row, rowIsHidden)}
                    onDragStart={movable ? startDrag(row) : undefined}
                    onDragOver={dragOver(row)}
                    onDragLeave={() => setDropOn((held) => (held === row.id ? null : held))}
                    onDrop={drop(row)}
                  />
                </div>
              );
            })}
          </div>
        </ContextMenu.Trigger>
        <OutlinerMenu
          row={menuRow}
          chunks={chunks}
          placeables={placeables}
          meshes={meshActions}
          onFrame={(picked) => {
            if (selected.has(picked.id) && runs.frameSelection !== null) runs.frameSelection();
            else frame(picked);
          }}
        />
      </ContextMenu.Root>
    </div>
  );
}

interface MapOutlinerProps {
  /** A count the header's collapse-all button raises, which collapses every open row. */
  readonly collapseAllSignal?: number;
}

/** Whether `row` folds: a section, a group or a chunk. */
function folds(row: SceneRow): boolean {
  return row.type === "section" || row.type === "group" || row.type === "chunk";
}

/** Whether `row` is an object a selection holds: a mesh or a placeable. */
function selectable(row: SceneRow): boolean {
  return row.type === "mesh" || row.type === "item";
}

function rowHidden(row: SceneRow, hidden: ReadonlySet<string>): boolean {
  switch (row.type) {
    case "chunk":
      return hidden.has(row.chunk.entry);
    case "item":
      return isHidden(hidden, row.chunk.entry, row.item.key);
    case "mesh":
      return hidden.has(row.id);
    case "guide":
      return !row.shown;
    default:
      return false;
  }
}

/** How many objects the narrowed tree keeps. */
function shownCount(rows: readonly SceneRow[]): number {
  let total = 0;
  for (const row of rows) {
    if (row.type === "chunk") total += row.shown;
    if (row.type === "mesh") total += 1;
  }
  return total;
}

/**
 * What a key asks of the tree from the row at `at`: a row to move to, a row to fold, the
 * row's own action, or nothing. `page` is how many rows a Page key moves.
 */
function navigation(
  key: string,
  row: SceneRow,
  at: number,
  rows: readonly SceneRow[],
  page: number,
  sectioned: boolean,
): number | "toggle" | "act" | null {
  const stepped = steppedRow(key, at, rows.length, page);
  if (stepped !== null) return stepped;

  switch (key) {
    case "Enter":
    case " ":
      return "act";
    case "ArrowRight":
      if (!folds(row)) return null;
      return "open" in row && row.open ? at + 1 : "toggle";
    case "ArrowLeft": {
      if (folds(row) && "open" in row && row.open) return "toggle";
      const level = rowLevel(row, sectioned);
      for (let up = at - 1; up >= 0; up -= 1) {
        const above = rows[up];
        if (above !== undefined && rowLevel(above, sectioned) < level) return up;
      }
      return null;
    }
    default:
      return null;
  }
}
