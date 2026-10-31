import { PlayIcon } from "@phosphor-icons/react";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type ReactNode,
  createContext,
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
import { NO_OVERSCROLL, useRemeasure, useResizeObserver, useZoomedPx } from "@/hooks";
import { m } from "@/i18n";
import type { AnimationGraph, GraphClip } from "@/lib/tauri";
import { measureRow, twMerge } from "@/utils";

import { instantScroll } from "../../../shared/utils/instantScroll";
import { FoldCaret } from "../../shared/components/FoldCaret";
import { Notice } from "../../shared/preview/Notice";
import { ROW_HEIGHT } from "../../tree/components/BinRow";
import { skinQueries } from "../api/skinQueries";
import {
  useClipFilterCommand,
  useClipPaneCommands,
  useClipSortCommands,
} from "../hooks/useClipCommands";
import type { GraphSource } from "../hooks/useGraphSource";
import { type ClipMark, SkinChoiceContext } from "../state/skinChoice";
import { CLIP_TABS } from "../utils/skinCommands";
import { chosenClipHash, playableClips } from "../utils/skinScene";
import { shownColumns } from "./ClipColumns";
import { ClipContextMenu } from "./ClipContextMenu";
import { ClipDetail } from "./ClipDetail";
import { MapTable } from "./ClipMaps";

/** The rows the filter leaves, by name or hash without regard to case, named ones first. */
export function matchingClips(clips: readonly GraphClip[], filter: string): GraphClip[] {
  const wanted = filter.trim().toLowerCase();
  const named = (clip: GraphClip) => clip.name !== clip.hash;
  const matches = (clip: GraphClip) =>
    clip.name.toLowerCase().includes(wanted) || clip.hash.toLowerCase().includes(wanted);

  return clips
    .filter((clip) => wanted === "" || matches(clip))
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
  /** `false` where the view has no preview, so a click selects any row and poses nothing. */
  readonly previewed?: boolean;
}

/**
 * The tab the reader picked over one graph: the clip table, or one of the sibling maps.
 *
 * "The clips pane" in docs/ux/SKIN_EDITOR.md. The graph is read once through the query and
 * every tab draws out of that one answer.
 */
export function ClipsPane({ source, joints, previewed = true }: ClipsPaneProps) {
  const choice = use(SkinChoiceContext);
  const graph = useQuery(skinQueries.graph(source.document, source.graph));
  const tab = choice?.tab ?? "clips";
  useClipPaneCommands(graph.data, previewed);

  if (source.graph === null) return <Notice text={m.workshop_bin_section_none_empty()} />;
  if (graph.error !== null) return <Notice text={m.workshop_bin_clip_graph_failed_empty()} />;
  if (graph.data === undefined) {
    return <Notice text={m.workshop_bin_clip_graph_loading_label()} />;
  }

  if (tab === "clips")
    return <ClipTable graph={graph.data} source={source} previewed={previewed} />;
  return <MapTable graph={graph.data} tab={tab} joints={joints} />;
}

/** The map control and name filter above the clip tables. */
export function ClipTabs() {
  const choice = use(SkinChoiceContext);
  const filterField = useClipFilterCommand();

  if (choice === null) return null;
  const { tab, setTab, filter, setFilter } = choice;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {tab === "clips" && (
        <Field.Control
          ref={filterField}
          size="xs"
          className="w-40 font-sans"
          aria-label={m.workshop_bin_clip_filter_label()}
          placeholder={m.workshop_bin_clip_filter_placeholder()}
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        />
      )}
      <SegmentedControl
        size="sm"
        className="ml-auto font-sans"
        aria-label={m.workshop_bin_clip_tabs_label()}
        value={tab}
        onChange={setTab}
        options={CLIP_TABS.map((each) => ({ value: each.value, label: each.label() }))}
      />
    </div>
  );
}

/**
 * One row per entry of `mClipDataMap`, sorted by name, with a column per thing a reader
 * scans for, and the clip's own fields under a row its caret unfolds.
 *
 * "The clips pane" in docs/ux/SKIN_EDITOR.md. A click poses the preview where the clip
 * reaches a file. The rows are windowed and measured, so a graph of a thousand clips
 * costs the rows on screen and an unfolded row takes the height its fields need.
 */
function ClipTable({
  graph,
  source,
  previewed,
}: {
  graph: AnimationGraph;
  source: GraphSource;
  previewed: boolean;
}) {
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

  useClipSortCommands(columns, sorting, setSorting);

  const playableList = useMemo(() => playableClips(graph.clips), [graph.clips]);
  const playable = useMemo(() => new Set(playableList.map((clip) => clip.hash)), [playableList]);
  /* The preview's opening clip poses it before any pick, so its row is marked as well. */
  const picked = choice?.picked ?? null;
  const posed = previewed ? chosenClipHash(playableList, picked) : picked;
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
            {column.key === "name" && previewed && <ClipPlaying hash={row.id} />}
            {column.draw(row.original)}
          </span>
        ),
      })),
    [columns, previewed],
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
      {(table) => (
        <PosedClip value={posed}>
          <VirtualClips table={table} source={source} playable={previewed ? playable : null} />
        </PosedClip>
      )}
    </DataTable>
  );
}

type ClipTableRow = GraphClip & { fps: number | undefined };

const ClipCells = memo(DataTableCells<ClipTableRow>);

/** The clip the preview poses, which a memoized cell reads apart from its row. */
const PosedClip = createContext<string | null>(null);

function ClipPlaying({ hash }: { hash: string }) {
  if (use(PosedClip) !== hash) return null;

  return (
    <PlayIcon
      weight="fill"
      role="img"
      aria-label={m.workshop_bin_clip_posing_label()}
      className="size-3 shrink-0 text-accent-300"
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
  /** The clips that a click poses, and null where a click selects any row. */
  playable: ReadonlySet<string> | null;
}) {
  const choice = use(SkinChoiceContext);
  const posed = use(PosedClip);
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
    estimateSize: () => rowHeight,
    overscan: 12,
    scrollMargin: headerHeight,
    scrollPaddingStart: headerHeight,
    getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
    measureElement: measureRow,
    scrollToFn: instantScroll,
  });
  useRemeasure(virtualizer, rowHeight);

  const marked = choice?.marked?.tab === "clips" ? choice.marked.hash : null;
  /* A jump lands on its row once, and a jump to the same row twice lands there again. Later
     changes of the rows, such as a typed filter or an edit, leave the scroll alone. */
  const mark = choice?.marked ?? null;
  const landed = useRef<ClipMark | null>(null);
  useEffect(() => {
    if (mark === null || mark.tab !== "clips" || landed.current === mark) return;

    const index = rows.findIndex((row) => row.id === mark.hash);
    if (index < 0) return;

    landed.current = mark;
    virtualizer.scrollToIndex(index, { align: "auto" });
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
                    posing={posed === clip.hash}
                    marked={marked === clip.hash}
                    expanded={expanded}
                    onToggle={() => choice?.toggleExpanded("clips", clip.hash)}
                    onClick={() => {
                      if (playable === null || playable.has(clip.hash)) {
                        choice?.setPicked(clip.hash);
                      }
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
        /* A chip and the caret inside the row answer their own keys. */
        if (event.target !== event.currentTarget) return;

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
      <FoldCaret open={expanded} onToggle={onToggle} label={foldLabel(expanded)} />
      {children}
    </div>
  );
}

/** A clip row's fold, named for what a click on it does. */
export function foldLabel(expanded: boolean): string {
  return expanded ? m.workshop_bin_clip_collapse_action() : m.workshop_bin_clip_expand_action();
}
