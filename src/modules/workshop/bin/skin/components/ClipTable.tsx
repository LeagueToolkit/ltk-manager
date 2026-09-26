import { CaretRightIcon, PlayIcon } from "@phosphor-icons/react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type ReactNode,
  memo,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  ContextMenu,
  DataTable,
  type DataTableColumn,
  DataTableCells,
  DataTableHeaders,
  type DataTableInstance,
  Field,
  SegmentedControl,
  Table,
} from "@/components";
import { NO_OVERSCROLL, useResizeObserver, useZoomedPx } from "@/hooks";
import { m } from "@/i18n";
import type { AnimationGraph, GraphClip } from "@/lib/tauri";
import { measureRow, twMerge } from "@/utils";

import { ROW_HEIGHT } from "../../tree/components/BinRow";
import { Notice } from "../../vfx/preview/components/Notice";
import { skinQueries } from "../api/skinQueries";
import type { GraphSource } from "../hooks/useGraphSource";
import { type ClipTab, SkinChoiceContext } from "../state/skinChoice";
import { playableClips } from "../utils/skinScene";
import { shownColumns } from "./ClipColumns";
import { ClipContextMenu } from "./ClipContextMenu";
import { ClipDetail } from "./ClipDetail";
import { MapTable } from "./ClipMaps";

/** The tabs in the order the control lists them, "The clips pane" in docs/ux/BIN_EDITOR.md. */
const TABS: readonly { value: ClipTab; label: () => string }[] = [
  { value: "clips", label: m.workshop_bin_clip_tab_clips_label },
  { value: "tracks", label: m.workshop_bin_clip_tab_tracks_label },
  { value: "masks", label: m.workshop_bin_clip_tab_masks_label },
  { value: "syncGroups", label: m.workshop_bin_clip_tab_sync_groups_label },
];

/** The rows the filter leaves, by name without regard to case, named ones first. */
export function matchingClips(clips: readonly GraphClip[], filter: string): GraphClip[] {
  const wanted = filter.trim().toLowerCase();
  const named = (clip: GraphClip) => clip.name !== clip.hash;
  return clips
    .filter((clip) => wanted === "" || clip.name.toLowerCase().includes(wanted))
    .sort((a, b) => {
      if (named(a) !== named(b)) return named(a) ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

interface ClipsPaneProps {
  /** Where the graph is read from. */
  readonly source: GraphSource;
  /** The skeleton's joint names by slot, which a mask's weights are listed against. */
  readonly joints: readonly string[] | null;
}

/**
 * The tab the reader picked over one graph: the clip table, or one of the sibling maps.
 *
 * "The clips pane" in docs/ux/BIN_EDITOR.md. The graph is read once through the query and
 * every tab draws out of that one answer.
 */
export function ClipsPane({ source, joints }: ClipsPaneProps) {
  const choice = use(SkinChoiceContext);
  const graph = useQuery(skinQueries.graph(source.document, source.graph));
  const tab = choice?.tab ?? "clips";

  if (source.graph === null) return <Notice text={m.workshop_bin_section_none_empty()} />;
  if (graph.error !== null) return <Notice text={m.workshop_bin_clip_graph_failed_empty()} />;
  if (graph.data === undefined) {
    return <Notice text={m.workshop_bin_clip_graph_loading_label()} />;
  }

  if (tab === "clips") return <ClipTable graph={graph.data} source={source} />;
  return <MapTable graph={graph.data} tab={tab} joints={joints} />;
}

/** The map control and name filter above the clip tables. */
export function ClipTabs() {
  const choice = use(SkinChoiceContext);
  if (choice === null) return null;
  const { tab, setTab, filter, setFilter } = choice;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tab === "clips" && (
        <Field.Control
          className="h-6 w-40 px-2 font-sans text-meta"
          aria-label={m.workshop_bin_clip_filter_label()}
          placeholder={m.workshop_bin_clip_filter_placeholder()}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      <SegmentedControl
        size="xs"
        className="ml-auto font-sans"
        aria-label={m.workshop_bin_clip_tabs_label()}
        value={tab}
        onChange={setTab}
        options={TABS.map((each) => ({ value: each.value, label: each.label() }))}
      />
    </div>
  );
}

/**
 * One row per entry of `mClipDataMap`, sorted by name, with a column per thing a reader
 * scans for, and the clip's own fields under a row its caret unfolds.
 *
 * "The clips pane" in docs/ux/BIN_EDITOR.md. A click poses the preview where the clip
 * reaches a file. The rows are windowed and measured, so a graph of a thousand clips
 * costs the rows on screen and an unfolded row takes the height its fields need.
 */
function ClipTable({ graph, source }: { graph: AnimationGraph; source: GraphSource }) {
  const choice = use(SkinChoiceContext);
  const client = useQueryClient();
  const [sorting, setSorting] = useState([{ id: "name", desc: false }]);
  const filter = choice?.filter ?? "";
  const assets = useMemo(
    () => [
      ...new Map(
        graph.clips.flatMap((clip) => {
          const asset = clip.animation?.asset;
          return asset ? [[JSON.stringify(asset), asset] as const] : [];
        }),
      ).entries(),
    ],
    [graph.clips],
  );
  const rates = useQuery(
    queryOptions({
      queryKey: ["skin-clip-rates", assets],
      enabled: sorting.some((column) => column.id === "rate"),
      staleTime: Infinity,
      queryFn: async () =>
        Object.fromEntries(
          await Promise.all(
            assets.map(async ([key, asset]) => {
              const header = await client
                .fetchQuery(skinQueries.clipHeader(asset))
                .catch(() => null);
              return [key, header?.fps];
            }),
          ),
        ),
    }),
  );
  const rows = useMemo(
    () =>
      matchingClips(graph.clips, filter).map((clip) => ({
        ...clip,
        fps: rates.data?.[JSON.stringify(clip.animation?.asset)],
      })),
    [graph.clips, filter, rates.data],
  );
  const columns = useMemo(() => shownColumns(graph.clips), [graph.clips]);
  const playable = useMemo(
    () => new Set(playableClips(graph.clips).map((clip) => clip.hash)),
    [graph.clips],
  );
  const tableColumns = useMemo<DataTableColumn<ClipTableRow>[]>(
    () =>
      columns.map((column) => ({
        id: column.key,
        accessorFn: (clip) =>
          column.key === "rate" ? (clip.fps ?? column.value(clip)) : column.value(clip),
        sortDescFirst: false,
        sortUndefined: "last",
        header: ({ column: tableColumn }) => {
          const direction = tableColumn.getIsSorted();
          return (
            <Table.Head
              aria-sort={
                direction === "asc" ? "ascending" : direction === "desc" ? "descending" : undefined
              }
              className={twMerge("shrink-0 truncate border-b-0 px-0", column.width)}
            >
              <Table.SortButton
                direction={direction}
                onClick={tableColumn.getToggleSortingHandler()}
              >
                {column.label()}
              </Table.SortButton>
            </Table.Head>
          );
        },
        cell: ({ row }) => (
          <span
            className={twMerge("flex shrink-0 items-center gap-2 overflow-hidden", column.width)}
          >
            {column.key === "name" && <ClipPlaying hash={row.id} />}
            {column.draw(row.original)}
          </span>
        ),
      })),
    [columns],
  );

  return (
    <DataTable
      ariaLabel={m.workshop_bin_clip_tab_clips_label()}
      options={{
        data: rows,
        getRowId: (clip) => clip.hash,
        state: { sorting },
        onSortingChange: setSorting,
        columns: tableColumns,
      }}
    >
      {(table) => <VirtualClips table={table} source={source} playable={playable} />}
    </DataTable>
  );
}

type ClipTableRow = GraphClip & { fps: number | undefined };

const ClipCells = memo(DataTableCells<ClipTableRow>);

function ClipPlaying({ hash }: { hash: string }) {
  const choice = use(SkinChoiceContext);
  if (choice?.picked !== hash) return null;
  return (
    <PlayIcon
      weight="fill"
      role="img"
      aria-label={m.workshop_bin_clip_posing_label()}
      className="h-3 w-3 shrink-0 text-accent-300"
    />
  );
}

function VirtualClips({
  table,
  source,
  playable,
}: {
  table: DataTableInstance<ClipTableRow>;
  source: GraphSource;
  playable: ReadonlySet<string>;
}) {
  const choice = use(SkinChoiceContext);
  const rows = table.getRowModel().rows;
  const scroller = useRef<HTMLDivElement>(null);
  const [menuClip, setMenuClip] = useState<GraphClip | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerRef = useResizeObserver<HTMLTableElement>((element) => {
    setHeaderHeight(element.getBoundingClientRect().height);
  });
  const zoomed = useZoomedPx();
  const rowHeight = zoomed(ROW_HEIGHT);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 12,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
    getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
    measureElement: measureRow,
  });

  const picked = choice?.picked ?? null;
  const marked = choice?.marked?.tab === "clips" ? choice.marked.hash : null;
  /* A jump lands on its row, and a jump to the same row twice lands there again. */
  const mark = choice?.marked ?? null;
  useEffect(() => {
    if (mark === null || mark.tab !== "clips") return;
    const index = rows.findIndex((row) => row.id === mark.hash);
    if (index >= 0) virtualizer.scrollToIndex(index, { align: "auto" });
  }, [mark, rows, virtualizer]);

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        onContextMenuCapture={() => setMenuClip(null)}
        ref={scroller}
        data-ui="ClipTable"
        className="min-h-0 flex-1 overflow-auto font-mono text-mono-row scrollbar-md"
        {...NO_OVERSCROLL}
      >
        <div className="min-w-max">
          <Table.Root
            ref={headerRef}
            className="sticky top-0 z-10 block bg-surface-800 font-sans select-none"
          >
            <Table.Header className="block">
              <Table.Row className="flex gap-2 border-b border-surface-700 px-1.5">
                <Table.Head aria-hidden="true" className="w-4 shrink-0 border-b-0 px-0" />
                <DataTableHeaders headers={table.getFlatHeaders()} customCells />
              </Table.Row>
            </Table.Header>
          </Table.Root>
          {rows.length === 0 && (
            <span className="px-1.5 text-meta text-surface-400">
              {m.workshop_bin_section_none_empty()}
            </span>
          )}
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (row === undefined) return null;
              const clip = row.original;
              const expanded = choice?.isExpanded("clips", clip.hash) ?? false;
              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  onContextMenu={() => setMenuClip(clip)}
                  data-index={item.index}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start - headerHeight}px)` }}
                >
                  <ClipRow
                    posing={picked === clip.hash}
                    marked={marked === clip.hash}
                    expanded={expanded}
                    onToggle={() => choice?.toggleExpanded("clips", clip.hash)}
                    onClick={() => {
                      if (playable.has(clip.hash)) choice?.setPicked(clip.hash);
                    }}
                  >
                    <ClipCells row={row} customCells />
                  </ClipRow>
                  {expanded && <ClipDetail source={source} clip={clip} />}
                </div>
              );
            })}
          </div>
        </div>
      </ContextMenu.Trigger>
      {menuClip !== null && <ClipContextMenu clip={menuClip} />}
    </ContextMenu.Root>
  );
}

interface ClipRowProps {
  readonly children: ReactNode;
  /** The preview plays this clip. */
  readonly posing: boolean;
  /** A chip jumped to this row. */
  readonly marked: boolean;
  /** The clip's fields stand under the row. */
  readonly expanded: boolean;
  readonly onToggle: () => void;
  readonly onClick: () => void;
}

/** One clip across the columns, marked for what the preview holds of it, with the caret that unfolds it. */
function ClipRow({ children, posing, marked, expanded, onToggle, onClick }: ClipRowProps) {
  return (
    <div
      role="button"
      tabIndex={0}
      data-ui="ClipTable:row"
      aria-pressed={posing}
      aria-expanded={expanded}
      /* DS-VEIL, DS-RADIUS */
      className={twMerge(
        "flex h-6 cursor-pointer items-center gap-2 rounded-sm px-1.5 hover:bg-surface-veil-soft",
        marked && "bg-accent-500/10",
        posing && "bg-accent-500/15",
      )}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
        if ((event.key === "ArrowRight" && !expanded) || (event.key === "ArrowLeft" && expanded)) {
          event.preventDefault();
          onToggle();
        }
      }}
    >
      <FoldCaret expanded={expanded} onToggle={onToggle} />
      {children}
    </div>
  );
}

/** The caret at a row's start that unfolds what the row holds, as a field row's does. */
export function FoldCaret({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-label={
        expanded ? m.workshop_bin_clip_collapse_action() : m.workshop_bin_clip_expand_action()
      }
      className="flex h-6 w-4 shrink-0 cursor-pointer items-center justify-center text-surface-400 hover:text-surface-200"
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    >
      <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", expanded && "rotate-90")} />
    </button>
  );
}
