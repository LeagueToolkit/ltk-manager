import {
  CaretRightIcon,
  CastleTurretIcon,
  CubeIcon,
  EyeIcon,
  EyeSlashIcon,
  type Icon,
  MapPinIcon,
  SelectionIcon,
  SparkleIcon,
  SpeakerHighIcon,
} from "@phosphor-icons/react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useZoomedPx } from "@/hooks";
import { m } from "@/i18n";
import type { MapItemKind } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { isCollapseAllKey } from "../../../shared/utils/treeGestures";
import { ROW_HEIGHT } from "../../tree/components/BinRow";
import { Notice } from "../../vfx/preview/components/Notice";
import { mapQueries } from "../api/mapQueries";
import { useMapScene } from "../state/mapScene";
import { chunkLabel, isDrawn, isHidden, type OutlineRow, outlineRows } from "../utils/mapOutline";

const KIND_ICON: Record<MapItemKind, Icon> = {
  particle: SparkleIcon,
  character: CastleTurretIcon,
  locator: MapPinIcon,
  group: SelectionIcon,
  audio: SpeakerHighIcon,
  other: CubeIcon,
};

/**
 * A map's chunk graph as a tree: each chunk of its `.materials.bin`, and what each holds.
 *
 * A row sends the camera to where its placeable stands, and an eye hides a chunk or one
 * placeable from the scene. Only what the scene draws has an eye, which is a particle and
 * a character. The rows are virtual, since one chunk of Summoner's Rift holds a thousand.
 */
export function MapOutliner({ collapseAllSignal = 0 }: MapOutlinerProps) {
  const { materials, chosen, variants, failed, hidden, setHidden, focus, focusOn } = useMapScene();
  const outline = useQuery(mapQueries.outline(materials));
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(() => outlineRows(outline.data ?? [], opened), [outline.data, opened]);

  const toggle = useCallback((chunk: string) => {
    setOpened((held) => {
      const next = new Set(held);
      if (!next.delete(chunk)) next.add(chunk);
      return next;
    });
  }, []);

  const collapseAll = useCallback(() => {
    setOpened((current) => (current.size === 0 ? current : new Set()));
  }, []);

  const collapsedFor = useRef(collapseAllSignal);
  useEffect(() => {
    if (collapseAllSignal === collapsedFor.current) return;
    collapsedFor.current = collapseAllSignal;
    collapseAll();
  }, [collapseAllSignal, collapseAll]);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!isCollapseAllKey(event)) return;

    event.preventDefault();
    collapseAll();
  }

  const scroller = useRef<HTMLDivElement>(null);
  const zoomed = useZoomedPx();
  const rowHeight = zoomed(ROW_HEIGHT);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scroller.current,
    estimateSize: useCallback(() => rowHeight, [rowHeight]),
    overscan: 12,
    getItemKey: useCallback((index: number) => rows[index]?.id ?? index, [rows]),
  });

  if (failed || outline.error !== null) {
    return <Notice text={m.workshop_bin_map_preview_failed_empty()} />;
  }
  if (variants !== undefined && chosen === null) {
    return <Notice text={m.workshop_bin_map_preview_missing_empty()} />;
  }
  if (outline.data === undefined)
    return <Notice text={m.workshop_bin_map_outliner_loading_label()} />;
  if (rows.length === 0) return <Notice text={m.workshop_bin_map_outliner_empty()} />;

  return (
    <div
      ref={scroller}
      data-ui="MapOutliner"
      role="tree"
      aria-label={m.workshop_bin_pane_outliner_label()}
      /* DS-SCROLLBAR */
      className="min-h-0 flex-1 overflow-y-auto p-1.5 font-mono text-mono-row scrollbar-md select-none"
      onKeyDown={handleKeyDown}
    >
      <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((virtual) => {
          const row = rows[virtual.index];
          return (
            <div
              key={virtual.key}
              className="absolute top-0 left-0 w-full"
              style={{ height: virtual.size, transform: `translateY(${virtual.start}px)` }}
            >
              <OutlinerRow
                row={row}
                hidden={rowHidden(row, hidden)}
                focused={row.type === "item" && focus?.id === row.id}
                onToggle={toggle}
                onHide={setHidden}
                onFocus={focusOn}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

interface MapOutlinerProps {
  /** A count the header's collapse-all button raises, which collapses every open chunk. */
  readonly collapseAllSignal?: number;
}

function rowHidden(row: OutlineRow, hidden: ReadonlySet<string>): boolean {
  return row.type === "chunk"
    ? hidden.has(row.chunk.entry)
    : isHidden(hidden, row.chunk.entry, row.item.key);
}

interface OutlinerRowProps {
  readonly row: OutlineRow;
  readonly hidden: boolean;
  /** The camera was last sent to this row. */
  readonly focused: boolean;
  readonly onToggle: (chunk: string) => void;
  readonly onHide: (id: string, hidden: boolean) => void;
  readonly onFocus: (focus: { id: string; position: readonly [number, number, number] }) => void;
}

function OutlinerRow({ row, hidden, focused, onToggle, onHide, onFocus }: OutlinerRowProps) {
  const chunk = row.type === "chunk";
  const Glyph = chunk ? null : KIND_ICON[row.item.kind];
  const activate = () => {
    if (row.type === "chunk") onToggle(row.chunk.entry);
    else onFocus({ id: row.id, position: row.item.position as [number, number, number] });
  };

  return (
    <div
      role="treeitem"
      aria-level={chunk ? 1 : 2}
      aria-expanded={row.type === "chunk" ? row.open : undefined}
      aria-selected={focused}
      tabIndex={0}
      className={twMerge(
        /* DS-VEIL, DS-RADIUS */
        "group/row flex h-full cursor-pointer items-center gap-1.5 rounded-sm pr-1 hover:bg-surface-veil-soft",
        !chunk && "pl-5",
        focused && "bg-accent-500/15",
        hidden && "text-surface-500",
      )}
      onClick={activate}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        activate();
      }}
    >
      {row.type === "chunk" && (
        <span className="flex h-4 w-3 shrink-0 items-center justify-center text-surface-400">
          <CaretRightIcon weight="bold" className={twMerge("h-3 w-3", row.open && "rotate-90")} />
        </span>
      )}
      {Glyph !== null && <Glyph className="h-3.5 w-3.5 shrink-0 text-surface-400" />}
      <span className="min-w-0 truncate">
        {row.type === "chunk" ? chunkLabel(row.chunk) : row.item.name}
      </span>
      <span className="ml-auto shrink-0 pl-2 text-meta text-surface-400">
        {row.type === "chunk" ? row.chunk.items.length : row.item.class}
      </span>
      {(row.type === "chunk" || isDrawn(row.item)) && (
        <EyeButton hidden={hidden} onClick={() => onHide(row.id, !hidden)} />
      )}
    </div>
  );
}

function EyeButton({ hidden, onClick }: { hidden: boolean; onClick: () => void }) {
  const label = hidden
    ? m.workshop_bin_map_outliner_show_action()
    : m.workshop_bin_map_outliner_hide_action();
  const Eye = hidden ? EyeSlashIcon : EyeIcon;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      /* DS-VEIL, DS-RADIUS. A hidden row keeps its eye on screen, since that is what says it is hidden. */
      className={twMerge(
        "flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-surface-400 hover:bg-surface-veil hover:text-surface-200 focus-visible:opacity-100",
        !hidden && "opacity-0 group-hover/row:opacity-100",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onKeyDown={(event) => {
        if (!isCollapseAllKey(event)) event.stopPropagation();
      }}
    >
      <Eye weight="bold" className="h-3.5 w-3.5" />
    </button>
  );
}
