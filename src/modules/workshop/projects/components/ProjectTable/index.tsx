import { useVirtualizer } from "@tanstack/react-virtual";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  ARRANGED_GROUP_HEIGHT,
  ARRANGED_HEADER_HEIGHT,
  ArrangedGroupHeading,
  type ArrangedSorting,
  ArrangedTableHeader,
  Checkbox,
  PickContext,
  ROW_HEIGHT,
  useArrangedColumns,
  useRowPicks,
} from "@/components";
import { m } from "@/i18n";
import type { WorkshopProject } from "@/lib/tauri";
import { useChampionRoster } from "@/modules/champions";
import { isChord } from "@/modules/keys";
import { twMerge } from "@/utils";

import {
  DEFAULT_WORKSHOP_SORT,
  PROJECT_COLUMNS,
  useHasActiveWorkshopFilters,
  useProjectTableStore,
  useRenameProjectDialog,
  useWorkshopFilterActions,
  useWorkshopSearchQuery,
  useWorkshopSelectionStore,
  useWorkshopSort,
  type WorkshopSortField,
} from "../../../state";
import { useWorkshopTestState } from "../../../testing/api/useWorkshopTestState";
import { useAnswerGridFocus } from "../../hooks/useProjectGridNav";
import { PROJECT_COLUMN_SPECS, PROJECT_GROUP_LABELS } from "./columns";
import { ProjectTableRow } from "./ProjectTableRow";
import {
  buildProjectRows,
  orderedProjectPaths,
  type ProjectGroupRow,
  type ProjectTableRow as Row,
} from "./rows";

/** Rows to keep mounted past each edge, so a fast scroll lands on drawn rows. */
const OVERSCAN = 8;

/** Space between the frame and the rows on each side, in pixels. */
const GUTTER = 8;
/* Room under the last row for the Test dock that floats over the table's bottom right corner. */
const DOCK_CLEARANCE = 48;

/** Space between the header and the first row, in pixels. */
const ROWS_TOP = 4;

/** Where the rows start, below the header and the space under it. */
const ROWS_OFFSET = ARRANGED_HEADER_HEIGHT + ROWS_TOP;

const pathOf = (row: Row) => (row.type === "project" ? row.project.path : null);
const selection = () => useWorkshopSelectionStore.getState();

interface ProjectTableProps {
  /** The projects to draw, already searched, filtered and sorted. */
  projects: WorkshopProject[];
  onEdit: (project: WorkshopProject) => void;
}

/**
 * The workshop's projects as a table, in columns the reader arranges.
 *
 * Search, filters, sort and the selection are the stores the grid reads. Per
 * "The table" in docs/ux/WORKSHOP.md.
 */
export function ProjectTable({ projects, onEdit }: ProjectTableProps) {
  const roster = useChampionRoster();
  const searchQuery = useWorkshopSearchQuery();
  const hasActiveFilters = useHasActiveWorkshopFilters();
  const narrowed = searchQuery.length > 0 || hasActiveFilters;
  const locked = useWorkshopTestState().kind !== "idle";

  const density = useProjectTableStore((s) => s.density);
  const groupBy = useProjectTableStore((s) => s.groupBy);
  const collapsedGroups = useProjectTableStore((s) => s.collapsedGroups);
  const toggleGroupCollapsed = useProjectTableStore((s) => s.toggleGroupCollapsed);
  const selectedPaths = useWorkshopSelectionStore((s) => s.selectedPaths);
  const openRename = useRenameProjectDialog((s) => s.open);

  const rows = useMemo(
    () => buildProjectRows({ projects, groupBy, collapsedGroups, narrowed, roster }),
    [projects, groupBy, collapsedGroups, narrowed, roster],
  );
  const paths = useMemo(() => orderedProjectPaths(rows), [rows]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  const {
    columns,
    headerColumns,
    totalWidth,
    style: columnStyle,
    moveColumn,
  } = useArrangedColumns({
    columns: PROJECT_COLUMNS,
    specs: PROJECT_COLUMN_SPECS,
    store: useProjectTableStore,
    scrollerRef,
    gutter: GUTTER,
  });

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollerRef.current,
    estimateSize: (index) =>
      rows[index].type === "group" ? ARRANGED_GROUP_HEIGHT : ROW_HEIGHT[density],
    getItemKey: (index) => rows[index].key,
    overscan: OVERSCAN,
    scrollMargin: ROWS_OFFSET,
    scrollPaddingStart: ROWS_OFFSET,
  });

  useEffect(() => {
    virtualizer.measure();
  }, [density, virtualizer]);

  useAnswerGridFocus(useCallback(() => scrollerRef.current?.focus(), []));

  const [currentKey, setCurrentKey] = useState<string | null>(null);
  const currentIndex = rows.findIndex((row) => row.key === currentKey);
  const current = rows[currentIndex];

  const { anchor, pick, rangeTo, startPick, paintOver } = useRowPicks(rows, pathOf, selection);

  const toggleGroup = useCallback(
    (rowKey: string) => {
      if (!narrowed) toggleGroupCollapsed(rowKey);
    },
    [narrowed, toggleGroupCollapsed],
  );

  const onPress = useCallback(
    (event: React.MouseEvent, rowKey: string, path: string) => {
      setCurrentKey(rowKey);
      if (event.shiftKey || event.ctrlKey || event.metaKey) {
        scrollerRef.current?.focus({ preventScroll: true });
        if (locked) return;
        if (event.shiftKey) rangeTo(rowKey, path);
        else pick(rowKey, path);
        return;
      }

      const project = projects.find((candidate) => candidate.path === path);
      if (project) onEdit(project);
    },
    [locked, rangeTo, pick, projects, onEdit],
  );

  const onRowEnter = useCallback(
    (rowKey: string, _path: string, buttons: number) => {
      paintOver(rowKey, buttons);
    },
    [paintOver],
  );

  const onPickStart = useCallback(
    (event: React.PointerEvent, rowKey: string, path: string, selected: boolean) => {
      scrollerRef.current?.focus({ preventScroll: true });
      setCurrentKey(rowKey);
      startPick(event, rowKey, path, selected);
    },
    [startPick],
  );

  const isPicked = (index: number) => {
    const row = rows[index];
    return row?.type === "project" && selectedPaths.has(row.project.path);
  };

  function moveCursor(index: number, extend: boolean) {
    const row = rows[index];
    if (!row) return;

    setCurrentKey(row.key);
    virtualizer.scrollToIndex(index, { align: "auto" });
    if (row.type !== "project" || locked) return;

    if (!extend) {
      anchor(row.key, row.project.path);
      return;
    }

    if (selection().anchorId === null && current?.type === "project") {
      anchor(current.key, current.project.path);
    }
    rangeTo(row.key, row.project.path);
  }

  /* A row's own control keeps Space and Enter, and the arrows leave it for the
     table. A key from a menu or popover arrives through the portal and is theirs. */
  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const grid = event.currentTarget;
    const target = event.target as HTMLElement;
    if (!grid.contains(target) || target.closest("input, textarea, [contenteditable]")) return;
    if (rows.length === 0) return;

    const onControl = target !== grid && target.closest("button, a, [role=switch]") !== null;
    const page = Math.max(1, Math.floor(grid.clientHeight / ROW_HEIGHT[density]) - 1);
    const last = rows.length - 1;
    const steps: Record<string, number> = {
      ArrowDown: Math.min(last, currentIndex + 1),
      ArrowUp: Math.max(0, currentIndex - 1),
      PageDown: Math.min(last, currentIndex + page),
      PageUp: Math.max(0, currentIndex - page),
      Home: 0,
      End: last,
    };

    if (event.key in steps) {
      event.preventDefault();
      if (onControl) grid.focus({ preventScroll: true });
      moveCursor(currentIndex === -1 ? 0 : steps[event.key], event.shiftKey);
      return;
    }

    if (!current || onControl) return;

    if (current.type === "group") {
      const opens = event.key === "ArrowRight" && !current.expanded;
      const closes = event.key === "ArrowLeft" && current.expanded;
      if (opens || closes || event.key === " " || event.key === "Enter") {
        event.preventDefault();
        toggleGroup(current.key);
      }
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      onEdit(current.project);
      return;
    }
    if (event.key === " ") {
      event.preventDefault();
      if (!locked) pick(current.key, current.project.path);
      return;
    }
    if (isChord(event, "projects.rename")) {
      event.preventDefault();
      openRename(current.project);
    }
  }

  const sort = useWorkshopSort();
  const { setSort } = useWorkshopFilterActions();
  const sorting: ArrangedSorting<WorkshopSortField> = {
    sort,
    onSort: setSort,
    defaultSort: DEFAULT_WORKSHOP_SORT,
    defaultLabel: m.workshop_table_sort_clear_action(),
  };

  return (
    <div
      ref={scrollerRef}
      role="grid"
      tabIndex={0}
      aria-label={m.workshop_table_label()}
      aria-rowcount={rows.length + 1}
      aria-colcount={columns.length}
      aria-multiselectable
      data-ui="ProjectTable"
      onKeyDown={handleKeyDown}
      style={columnStyle}
      className="group/table relative min-h-0 flex-1 overflow-auto outline-none scrollbar-md"
    >
      <div
        style={{
          width: totalWidth + 2 * GUTTER,
          minWidth: "100%",
          paddingBottom: GUTTER + DOCK_CLEARANCE,
        }}
      >
        <ArrangedTableHeader
          columns={headerColumns}
          store={useProjectTableStore}
          sorting={sorting}
          groupLabels={PROJECT_GROUP_LABELS}
          ungrouped="none"
          onMoveColumn={moveColumn}
          renderCell={(spec) => {
            if (spec.id !== "select") return undefined;
            return <PickAll paths={paths} label={m.workshop_table_select_all_label()} />;
          }}
        />
        <PickContext value={onPickStart}>
          <div
            role="rowgroup"
            style={{ height: virtualizer.getTotalSize(), marginTop: ROWS_TOP }}
            className="relative mx-2"
          >
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              const top = item.start - ROWS_OFFSET;

              if (row.type === "group") {
                return (
                  <ProjectGroupHeading
                    key={row.key}
                    row={row}
                    columns={columns}
                    isCurrent={row.key === currentKey}
                    narrowed={narrowed}
                    top={top}
                    onPress={() => {
                      setCurrentKey(row.key);
                      toggleGroup(row.key);
                      scrollerRef.current?.focus({ preventScroll: true });
                    }}
                    onExpand={() => toggleGroup(row.key)}
                  />
                );
              }

              return (
                <ProjectTableRow
                  key={row.key}
                  project={row.project}
                  rowKey={row.key}
                  columns={columns}
                  density={density}
                  isCurrent={row.key === currentKey}
                  joinTop={isPicked(item.index) && isPicked(item.index - 1)}
                  joinBottom={isPicked(item.index) && isPicked(item.index + 1)}
                  top={top}
                  height={item.size}
                  onPress={onPress}
                  onRowEnter={onRowEnter}
                  onEdit={onEdit}
                />
              );
            })}
          </div>
        </PickContext>
      </div>
    </div>
  );
}

/** A checkbox over a set of projects: every one of them, or none. Quiet while a session runs. */
export function PickAll({
  paths,
  label,
  onPicked,
  className,
}: {
  paths: string[];
  label: string;
  onPicked?: () => void;
  className?: string;
}) {
  const picked = useWorkshopSelectionStore(
    (s) => paths.filter((path) => s.selectedPaths.has(path)).length,
  );
  const addMany = useWorkshopSelectionStore((s) => s.addMany);
  const removeMany = useWorkshopSelectionStore((s) => s.removeMany);
  const locked = useWorkshopTestState().kind !== "idle";
  const all = paths.length > 0 && picked === paths.length;

  function handleChange() {
    if (all) {
      removeMany(paths);
      return;
    }
    addMany(paths);
    onPicked?.();
  }

  return (
    <span data-no-row className={twMerge("flex", className)}>
      <Checkbox
        size="sm"
        checked={all}
        indeterminate={picked > 0 && !all}
        disabled={locked}
        onCheckedChange={handleChange}
        aria-label={label}
      />
    </span>
  );
}

interface ProjectGroupHeadingProps {
  row: ProjectGroupRow;
  columns: Parameters<typeof ArrangedGroupHeading>[0]["columns"];
  isCurrent: boolean;
  narrowed: boolean;
  top: number;
  onPress: () => void;
  onExpand: () => void;
}

/** A group heading over projects, whose checkbox opens a folded group as it picks. */
function ProjectGroupHeading({
  row,
  columns,
  isCurrent,
  narrowed,
  top,
  onPress,
  onExpand,
}: ProjectGroupHeadingProps) {
  const paths = useMemo(() => row.projects.map((project) => project.path), [row.projects]);
  const hasSelection = useWorkshopSelectionStore((s) => s.selectedPaths.size > 0);

  return (
    <ArrangedGroupHeading
      columns={columns}
      label={row.label}
      count={m.workshop_table_group_count_label({ count: row.projects.length })}
      expanded={row.expanded}
      foldable={!narrowed}
      isCurrent={isCurrent}
      top={top}
      pick={
        <PickAll
          paths={paths}
          label={m.workshop_table_group_select_label({ group: row.label })}
          onPicked={() => !row.expanded && onExpand()}
          className={twMerge(
            !hasSelection &&
              "opacity-0 transition-opacity group-hover/row:opacity-100 focus-within:opacity-100",
          )}
        />
      }
      onPress={onPress}
    />
  );
}
