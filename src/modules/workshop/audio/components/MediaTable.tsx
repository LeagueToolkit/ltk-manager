import {
  DownloadSimpleIcon,
  FileArrowDownIcon,
  HashIcon,
  PlayIcon,
  StopIcon,
} from "@phosphor-icons/react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ContextMenu, IconButton, Table } from "@/components";
import { NO_OVERSCROLL, useRemeasure, useResizeObserver, useZoomedPx } from "@/hooks";
import { m } from "@/i18n";
import type { MediaRow } from "@/lib/tauri";
import { measureRow, twMerge } from "@/utils";
import { formatBytes } from "@/utils/formatBytes";

import { instantScroll } from "../../shared/utils/instantScroll";
import type { MediaActions } from "../hooks/useMediaActions";
import type { MediaPlayer } from "../hooks/useMediaPlayer";
import { useTypeAhead } from "../hooks/useTypeAhead";
import { type AudioCommandId, menuShortcut, resolveCommand } from "../utils/keymap";
import {
  codecLabel,
  decodedExtension,
  formatDuration,
  type MediaSort,
  type MediaSortKey,
  nextSort,
} from "../utils/mediaRows";
import { movedIndex, pageRows } from "../utils/rowKeys";
import { type PickMode, pickMode } from "../utils/rowSelection";
import { AUDIO_LIST_GROUP, audioRowClasses, MIDDLE_BUTTON } from "./audioRow";
import { MediaThumbnail } from "./WaveformThumbnail";

interface MediaTableProps {
  /** The rows to draw, filtered and sorted. */
  readonly rows: readonly MediaRow[];
  readonly sort: MediaSort | null;
  readonly onSort: (sort: MediaSort | null) => void;
  readonly selected: number | null;
  readonly picked: ReadonlySet<number>;
  readonly onSelect: (source: number, mode: PickMode) => void;
  readonly onSelectAll: () => void;
  readonly onClear: () => void;
  readonly player: MediaPlayer;
  readonly actions: MediaActions;
  readonly focusSerial?: number | null;
}

/** The height of a row in px at 100% zoom: `h-6` is six spacing units of 4.5px. */
const ROW_HEIGHT = 27;

/**
 * The media of one audio file, one row per source ID, windowed.
 *
 * The keyboard map and the row actions are "Media table" in docs/ux/AUDIO.md. The table is one
 * tab stop, and the menu key opens the context menu of the selected row.
 */
export function MediaTable({
  rows,
  sort,
  onSort,
  selected,
  picked,
  onSelect,
  onSelectAll,
  onClear,
  player,
  actions,
  focusSerial = null,
}: MediaTableProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const lastFocusSerial = useRef<number | null | undefined>(undefined);
  const [menuRow, setMenuRow] = useState<MediaRow | null>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  const headerRef = useResizeObserver<HTMLDivElement>((element) => {
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
    getItemKey: useCallback((index: number) => rows[index]?.sourceId ?? index, [rows]),
    scrollToFn: instantScroll,
    measureElement: measureRow,
  });
  useRemeasure(virtualizer, rowHeight);

  const selectedIndex = selected === null ? -1 : rows.findIndex((row) => row.sourceId === selected);

  /* A selection made outside the table, such as the event tree's Show media, scrolls into view. */
  useEffect(() => {
    if (selectedIndex < 0) return;

    const isFocusRequest = focusSerial != null && focusSerial !== lastFocusSerial.current;
    lastFocusSerial.current = focusSerial;
    const frameId = requestAnimationFrame(() => {
      virtualizer.scrollToIndex(selectedIndex, { align: isFocusRequest ? "center" : "auto" });
    });
    return () => cancelAnimationFrame(frameId);
  }, [selectedIndex, selected, focusSerial, virtualizer, rows.length]);

  function selectAt(index: number, range = false) {
    const row = rows[Math.max(0, Math.min(rows.length - 1, index))];
    if (row === undefined) return;

    onSelect(row.sourceId, range ? "range" : "only");
    virtualizer.scrollToIndex(rows.indexOf(row), { align: "auto" });
  }

  const typeAhead = useTypeAhead(
    () => rows.map((row) => String(row.sourceId)),
    selectedIndex,
    (index) => selectAt(index),
  );

  /** Runs `command`, which `key` resolved to. Returns `true` if the table answers the key. */
  function run(command: AudioCommandId, key: string): boolean {
    const row = rows[selectedIndex];
    switch (command) {
      case "moveRow":
      case "movePage":
      case "moveEnd": {
        const page = pageRows(scroller.current, rowHeight);
        const target = movedIndex(key, selectedIndex, rows.length, page);
        if (target !== null) selectAt(target);
        return true;
      }
      case "extendRange": {
        const page = pageRows(scroller.current, rowHeight);
        const target = movedIndex(key, selectedIndex, rows.length, page);
        if (target !== null) selectAt(target, true);
        return true;
      }
      case "selectAll":
        onSelectAll();
        return true;
      case "play":
      case "enter":
        if (row?.playback.kind === "playable") player.toggle(row.sourceId);
        return row !== undefined;
      case "stop":
        if (player.playing === null) return false;
        player.channel.stopAll();
        return true;
      case "copy":
        if (row !== undefined) actions.copySource(row);
        return row !== undefined;
      default:
        return false;
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;

    if (event.key === "Escape") {
      onClear();
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    const command = resolveCommand(event, "media");
    const handled = command === null ? typeAhead(event) : run(command, event.key);
    if (!handled) return;

    event.preventDefault();
    event.stopPropagation();
  }

  const header = (key: MediaSortKey, label: string) => (
    <Table.SortButton
      direction={sortDirection(sort, key)}
      onClick={() => onSort(nextSort(sort, key))}
    >
      {label}
    </Table.SortButton>
  );

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        onContextMenuCapture={() =>
          setMenuRow(selectedIndex >= 0 ? (rows[selectedIndex] ?? null) : null)
        }
        ref={scroller}
        role="grid"
        tabIndex={0}
        aria-label={m.audio_table_label()}
        aria-multiselectable
        aria-rowcount={rows.length}
        aria-activedescendant={selected === null ? undefined : rowId(selected)}
        onKeyDown={handleKeyDown}
        onClick={(event) => {
          if (
            (event.target as HTMLElement).closest('[data-ui="MediaTable:row"], [role="row"]') ===
            null
          ) {
            onClear();
          }
        }}
        onFocus={(event) => {
          if (
            event.target === event.currentTarget &&
            selectedIndex < 0 &&
            event.currentTarget.matches(":focus-visible")
          ) {
            selectAt(0);
          }
        }}
        data-ui="MediaTable"
        className={twMerge(
          AUDIO_LIST_GROUP,
          "min-h-0 flex-1 overflow-auto text-row scrollbar-md focus-visible:outline-none",
        )}
        {...NO_OVERSCROLL}
      >
        <div className="min-w-max">
          <div
            ref={headerRef}
            role="row"
            className="sticky top-0 z-10 flex h-7 items-center gap-3 border-b border-surface-700 bg-surface-950 px-2 text-meta text-surface-400 select-none"
          >
            <span role="columnheader" aria-hidden="true" className={COLUMN.play} />
            <span role="columnheader" className={COLUMN.source}>
              {header("source", m.audio_column_source_label())}
            </span>
            <span role="columnheader" className={COLUMN.codec}>
              {m.audio_column_codec_label()}
            </span>
            <span role="columnheader" className={COLUMN.channels}>
              {m.audio_column_channels_label()}
            </span>
            <span role="columnheader" className={COLUMN.rate}>
              {m.audio_column_rate_label()}
            </span>
            <span role="columnheader" className={COLUMN.duration}>
              {header("duration", m.audio_column_duration_label())}
            </span>
            <span role="columnheader" className={COLUMN.size}>
              {header("size", m.audio_column_size_label())}
            </span>
            <span role="columnheader" className={COLUMN.waveform}>
              {m.audio_column_waveform_label()}
            </span>
          </div>
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const row = rows[item.index];
              if (row === undefined) return null;

              return (
                <div
                  key={item.key}
                  ref={virtualizer.measureElement}
                  data-index={item.index}
                  className="absolute top-0 left-0 w-full"
                  style={{ transform: `translateY(${item.start - headerHeight}px)` }}
                  onContextMenu={() => {
                    if (!picked.has(row.sourceId)) {
                      onSelect(row.sourceId, "only");
                    }
                    setMenuRow(row);
                  }}
                >
                  <MediaLine
                    row={row}
                    index={item.index}
                    selected={row.sourceId === selected || picked.has(row.sourceId)}
                    playing={player.playing === row.sourceId}
                    failed={player.failed.has(row.sourceId)}
                    url={player.url(row.sourceId)}
                    onSelect={(event) => onSelect(row.sourceId, pickMode(event))}
                    onToggle={() => {
                      if (!picked.has(row.sourceId)) {
                        onSelect(row.sourceId, "only");
                      }
                      player.toggle(row.sourceId);
                    }}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </ContextMenu.Trigger>
      {menuRow !== null && <MediaContextMenu row={menuRow} actions={actions} />}
    </ContextMenu.Root>
  );
}

/** The text of a cell whose value the header of the media does not give. */
const NO_VALUE = "-";

/** The width of each column, shared by the header and the rows. */
const COLUMN = {
  play: "w-5 shrink-0",
  source: "w-28 shrink-0",
  codec: "w-16 shrink-0",
  channels: "w-8 shrink-0 text-right",
  rate: "w-14 shrink-0 text-right",
  duration: "w-20 shrink-0 text-right",
  size: "w-20 shrink-0 text-right",
  waveform: "w-24 shrink-0",
} as const;

/** Returns the direction that the header of `key` shows, or `false` if the table sorts by another. */
function sortDirection(sort: MediaSort | null, key: MediaSortKey): "asc" | "desc" | false {
  if (sort?.key !== key) return false;
  return sort.descending ? "desc" : "asc";
}

/** Returns the DOM id of the row of `source`, which the grid names as its active row. */
function rowId(source: number): string {
  return `media-row-${source}`;
}

interface MediaLineProps {
  readonly row: MediaRow;
  readonly index: number;
  readonly selected: boolean;
  readonly playing: boolean;
  readonly failed: boolean;
  /** The URL that the row plays from. */
  readonly url: string;
  readonly onSelect: (event: React.MouseEvent) => void;
  readonly onToggle: () => void;
}

/** One media across the columns, with the play button that starts and stops it. */
function MediaLine({
  row,
  index,
  selected,
  playing,
  failed,
  url,
  onSelect,
  onToggle,
}: MediaLineProps) {
  const format = row.format;
  const source = String(row.sourceId);
  const codec = format === null ? NO_VALUE : codecLabel(format.codec);
  const duration =
    format?.durationSeconds == null ? NO_VALUE : formatDuration(format.durationSeconds);

  return (
    <div
      id={rowId(row.sourceId)}
      role="row"
      aria-rowindex={index + 1}
      aria-selected={selected}
      data-ui="MediaTable:row"
      className={twMerge(audioRowClasses({ selected, playing }), "gap-3 pl-2")}
      onClick={onSelect}
      onPointerDown={(event) => {
        /* A middle press scrolls the page in Chromium unless its default is dropped. */
        if (event.button === MIDDLE_BUTTON) event.preventDefault();
      }}
      onAuxClick={(event) => {
        if (event.button !== MIDDLE_BUTTON || row.playback.kind !== "playable") return;

        event.preventDefault();
        onToggle();
      }}
    >
      <span role="gridcell" className={COLUMN.play}>
        <PlayButton
          row={row}
          playing={playing}
          failed={failed}
          onToggle={onToggle}
        />
      </span>
      <Cell className={twMerge(COLUMN.source, "font-mono text-code text-surface-200 select-text")}>
        {source}
      </Cell>
      <Cell className={COLUMN.codec}>{codec}</Cell>
      <Cell className={twMerge(COLUMN.channels, "font-mono text-code")}>
        {format?.channels ?? NO_VALUE}
      </Cell>
      <Cell className={twMerge(COLUMN.rate, "font-mono text-code")}>
        {format?.sampleRate ?? NO_VALUE}
      </Cell>
      <Cell className={twMerge(COLUMN.duration, "font-mono text-code")}>{duration}</Cell>
      <Cell className={twMerge(COLUMN.size, "font-mono text-code")}>
        {formatBytes(row.sizeBytes)}
      </Cell>
      <span role="gridcell" className={COLUMN.waveform}>
        <MediaThumbnail
          url={unplayableReason(row, failed) === null ? url : null}
          playing={playing}
        />
      </span>
    </div>
  );
}

function Cell({ className, children }: { className: string; children: ReactNode }) {
  return (
    <span role="gridcell" className={twMerge("truncate text-surface-300", className)}>
      {children}
    </span>
  );
}

interface PlayButtonProps {
  readonly row: MediaRow;
  readonly playing: boolean;
  readonly failed: boolean;
  readonly onToggle: () => void;
}

/** The play or stop button of a row, disabled with its reason for a media that cannot play. */
function PlayButton({ row, playing, failed, onToggle }: PlayButtonProps) {
  const source = String(row.sourceId);
  const reason = unplayableReason(row, failed);
  const label = playing ? m.audio_stop_action({ source }) : m.audio_play_action({ source });
  const Glyph = playing ? StopIcon : PlayIcon;

  return (
    <IconButton
      size="row"
      tabIndex={-1}
      icon={<Glyph weight="fill" />}
      label={label}
      pressed={playing}
      disabled={reason !== null}
      disabledReason={reason ?? undefined}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
    />
  );
}

/** Returns why `row` does not play, or `null` if it plays. */
function unplayableReason(row: MediaRow, failed: boolean): string | null {
  if (row.playback.kind === "unsupportedCodec") return m.audio_unplayable_hint();
  if (row.playback.kind === "unreadable") {
    return m.audio_unreadable_hint({ reason: row.playback.message });
  }
  if (failed) return m.audio_play_failed_label({ source: String(row.sourceId) });
  return null;
}

/** The actions of one row: its two saves and the copy of its source ID. */
function MediaContextMenu({ row, actions }: { row: MediaRow; actions: MediaActions }) {
  const decodable = row.playback.kind === "playable";

  return (
    <ContextMenu.Content>
      <ContextMenu.Item
        icon={<DownloadSimpleIcon />}
        disabled={!decodable || actions.busy}
        onClick={() => actions.saveDecoded(row)}
      >
        {m.audio_save_decoded_action({ extension: decodedExtension(row) })}
      </ContextMenu.Item>
      <ContextMenu.Item
        icon={<FileArrowDownIcon />}
        disabled={actions.busy}
        onClick={() => actions.saveOriginal(row)}
      >
        {m.audio_save_original_action()}
      </ContextMenu.Item>
      <ContextMenu.Item
        icon={<HashIcon />}
        shortcut={menuShortcut("copy")}
        onClick={() => actions.copySource(row)}
      >
        {m.audio_copy_source_action()}
      </ContextMenu.Item>
    </ContextMenu.Content>
  );
}
