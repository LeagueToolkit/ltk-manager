import {
  BoundingBoxIcon,
  CaretRightIcon,
  CastleTurretIcon,
  CubeIcon,
  EyeIcon,
  EyeSlashIcon,
  FolderSimpleIcon,
  GlobeSimpleIcon,
  GridFourIcon,
  type Icon,
  LightbulbIcon,
  LightningIcon,
  LockSimpleIcon,
  MapPinIcon,
  PathIcon,
  PolygonIcon,
  RulerIcon,
  SelectionIcon,
  ShuffleIcon,
  SparkleIcon,
  SpeakerHighIcon,
  StackIcon,
} from "@phosphor-icons/react";
import type { DragEvent, MouseEvent } from "react";

import { Tooltip } from "@/components";
import { m } from "@/i18n";
import type { MapItemKind } from "@/lib/tauri";
import { twMerge } from "@/utils";

import { MatchedText } from "../../../shared/components/MatchedText";
import { chunkLabel, isDrawn } from "../utils/mapOutline";
import type { SceneRow, SectionId } from "../utils/sceneOutline";

const KIND_ICON: Record<MapItemKind, Icon> = {
  particle: SparkleIcon,
  character: CastleTurretIcon,
  locator: MapPinIcon,
  group: SelectionIcon,
  audio: SpeakerHighIcon,
  light: LightbulbIcon,
  probe: GlobeSimpleIcon,
  volume: BoundingBoxIcon,
  path: PathIcon,
  region: PolygonIcon,
  other: CubeIcon,
};

const SECTION_ICON: Record<SectionId, Icon> = {
  "section:meshes": PolygonIcon,
  "section:placeables": StackIcon,
  "section:guides": RulerIcon,
};

const SECTION_LABEL: Record<SectionId, () => string> = {
  "section:meshes": m.workshop_bin_map_outliner_meshes_label,
  "section:placeables": m.workshop_bin_map_markers_label,
  "section:guides": m.workshop_bin_map_guides_label,
};

/** How far each level of the tree steps in, in pixels at 100% zoom. */
const INDENT = 12;

interface OutlinerRowProps {
  /** The row's element id, which the tree names as its active descendant. */
  readonly domId: string;
  readonly row: SceneRow;
  /** How deep the row sits, 1 for the top. */
  readonly level: number;
  readonly hidden: boolean;
  /** The camera was last sent to this row. */
  readonly focused: boolean;
  /** The object is in the selection the viewport and the outliner share. */
  readonly selected: boolean;
  /** The keyboard stands on this row. */
  readonly active: boolean;
  /** The search text, marked where the row's text holds it. */
  readonly query: string;
  /** The filter narrows the tree, so a chunk counts what it keeps of what it holds. */
  readonly narrowed: boolean;
  /** A drag over the row would drop onto it. */
  readonly dropping: boolean;
  /** The name a controller hash reads as. */
  readonly controllerName: (hash: string) => string;
  readonly onActivate: (event: MouseEvent) => void;
  readonly onHide: () => void;
  /** Starts a drag of the row's object, and absent for a row that does not move. */
  readonly onDragStart?: (event: DragEvent) => void;
  /** Takes a drop onto the row, and absent for a row that takes none. */
  readonly onDrop?: (event: DragEvent) => void;
  readonly onDragOver?: (event: DragEvent) => void;
  readonly onDragLeave?: () => void;
}

/**
 * One row of the map outliner: a collection, a controller group, a mesh, a chunk or a
 * placeable. A folding row has a caret and a count, an object its kind and an eye, and a
 * placeable the marker of an event that shows it. A mesh or a placeable drags onto a group or
 * a chunk to move under it.
 */
export function OutlinerRow({
  domId,
  row,
  level,
  hidden,
  focused,
  selected,
  active,
  query,
  narrowed,
  dropping,
  controllerName,
  onActivate,
  onHide,
  onDragStart,
  onDrop,
  onDragOver,
  onDragLeave,
}: OutlinerRowProps) {
  const folds = row.type === "section" || row.type === "group" || row.type === "chunk";
  const open = folds && row.open;
  const Glyph = glyphOf(row);
  const text = labelOf(row, controllerName);
  const eye =
    row.type === "chunk" ||
    row.type === "mesh" ||
    row.type === "guide" ||
    (row.type === "item" && isDrawn(row.item));

  return (
    <div
      id={domId}
      role="treeitem"
      aria-level={level}
      aria-expanded={folds ? open : undefined}
      aria-selected={selected}
      draggable={onDragStart !== undefined}
      className={twMerge(
        /* DS-VEIL, DS-RADIUS */
        "group/row flex h-full cursor-pointer items-center gap-1.5 rounded-sm pr-1 hover:bg-surface-veil-soft",
        row.type === "section" && "font-medium text-surface-200",
        selected && "bg-accent-500/15",
        focused && "text-accent-300",
        active && "ring-1 ring-accent-500/60 ring-inset",
        dropping && "ring-1 ring-accent-400 ring-inset",
        hidden && "text-surface-500",
      )}
      style={{ paddingLeft: (level - 1) * INDENT + (folds ? 0 : INDENT) }}
      onClick={onActivate}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      {folds && (
        <span className="flex h-4 w-3 shrink-0 items-center justify-center text-surface-400">
          <CaretRightIcon weight="bold" className={twMerge("size-3", open && "rotate-90")} />
        </span>
      )}
      {Glyph !== null && <Glyph className="size-3.5 shrink-0 text-surface-400" />}
      <span className="min-w-0 shrink truncate">
        <MatchedText text={text} query={query} />
      </span>
      {row.type === "item" && row.item.controller !== null && <EventMark />}
      {/* The meta gives way before the name does. */}
      <span className="ml-auto min-w-0 shrink-[4] truncate pl-2 text-meta text-surface-400">
        <RowMeta row={row} narrowed={narrowed} query={query} />
      </span>
      {row.type === "guide" && <GuideLock />}
      {eye && (
        <EyeButton
          hidden={hidden}
          disabled={row.type === "guide" && row.following}
          onClick={onHide}
        />
      )}
    </div>
  );
}

function glyphOf(row: SceneRow): Icon | null {
  switch (row.type) {
    case "section":
      return SECTION_ICON[row.id];
    case "guide":
      return row.guide.kind === "navGrid" ? GridFourIcon : StackIcon;
    case "group":
      return ShuffleIcon;
    case "mesh":
      return PolygonIcon;
    case "chunk":
      return FolderSimpleIcon;
    case "item":
      return KIND_ICON[row.item.kind];
  }
}

function labelOf(row: SceneRow, controllerName: (hash: string) => string): string {
  switch (row.type) {
    case "section":
      return SECTION_LABEL[row.id]();
    case "guide":
      return row.label ?? m.workshop_bin_map_navgrid_label();
    case "group":
      return row.controller === null
        ? m.workshop_bin_map_mesh_no_controller_label()
        : controllerName(row.controller);
    case "mesh":
      return m.workshop_bin_map_mesh_title({ index: row.mesh.index });
    case "chunk":
      return chunkLabel(row.chunk);
    case "item":
      return row.item.name;
  }
}

function RowMeta({ row, narrowed, query }: { row: SceneRow; narrowed: boolean; query: string }) {
  switch (row.type) {
    case "section":
      return row.count;
    case "group":
      return row.meshes.length;
    case "mesh":
      return <MatchedText text={lastSegment(row.mesh.materials[0] ?? "")} query={query} />;
    case "chunk":
      if (!narrowed) return row.chunk.items.length;
      return `${row.shown}/${row.chunk.items.length}`;
    case "item":
      return <MatchedText text={row.item.class} query={query} />;
    case "guide":
      return null;
  }
}

/** The lock that marks a guide row as read-only. */
function GuideLock() {
  const hint = m.workshop_bin_map_guide_lock_hint();
  return (
    <Tooltip content={hint}>
      <span aria-label={hint} className="flex shrink-0 text-surface-500">
        <LockSimpleIcon weight="bold" className="size-3" />
      </span>
    </Tooltip>
  );
}

/** The last segment of a material's entry path, which tells most of a map's materials apart. */
function lastSegment(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The marker of a placeable an event shows, which the Event effects switch plays. */
function EventMark() {
  const hint = m.workshop_bin_map_outliner_event_hint();
  return (
    <Tooltip content={hint}>
      <span aria-label={hint} className="flex shrink-0 text-warning-text">
        <LightningIcon weight="fill" className="size-3" />
      </span>
    </Tooltip>
  );
}

interface EyeButtonProps {
  readonly hidden: boolean;
  /** The eye shows a state that something else sets, such as an overlay that follows the map state. */
  readonly disabled?: boolean;
  readonly onClick: () => void;
}

function EyeButton({ hidden, disabled = false, onClick }: EyeButtonProps) {
  const label = hidden
    ? m.workshop_bin_map_outliner_show_action()
    : m.workshop_bin_map_outliner_hide_action();
  const Eye = hidden ? EyeSlashIcon : EyeIcon;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={label}
      title={label}
      disabled={disabled}
      /* DS-VEIL, DS-RADIUS. A hidden row keeps its eye on screen, since that is what says it is hidden. */
      className={twMerge(
        "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-surface-400 hover:bg-surface-veil hover:text-surface-200",
        !hidden && "opacity-0 group-hover/row:opacity-100",
        disabled && "cursor-default opacity-50 hover:bg-transparent hover:text-surface-400",
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      <Eye weight="bold" className="size-3.5" />
    </button>
  );
}
