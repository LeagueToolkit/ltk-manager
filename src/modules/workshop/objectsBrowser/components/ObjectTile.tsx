import {
  CaretRightIcon,
  CubeIcon,
  FolderIcon,
  type Icon,
  PersonSimpleIcon,
  SparkleIcon,
  SphereIcon,
  SpinnerGapIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import { memo } from "react";

import { Button, Tooltip } from "@/components";
import { m } from "@/i18n";
import { twMerge } from "@/utils";

import { fitName, type NameType } from "../../explorer/utils/tileName";
import { clickIntent } from "../../state";
import { useOpenObjectNode } from "../hooks/useOpenObjectNode";
import type { PreviewOutcome } from "../state/previewStills";
import { type ObjectPreviewKind, objectPreviewKind } from "../utils/objectPreview";
import type { ObjectPrefixNode, ObjectRowNode } from "../utils/objectTree";

/** Lines an object's name wraps to before it is cut, leaving room for its class line. */
export const TILE_NAME_LINES = 2;

const KIND_GLYPH: Record<ObjectPreviewKind, Icon> = {
  vfx: SparkleIcon,
  skin: PersonSimpleIcon,
  material: SphereIcon,
};

interface ObjectTileProps {
  node: ObjectPrefixNode | ObjectRowNode;
  index: number;
  column: number;
  /** The tile's drawn width in px, which the zoom has already been applied to. */
  width: number;
  artHeight: number;
  nameType: NameType;
  /** Whether the grid's roving tab stop is on this tile. */
  focused: boolean;
  selected: boolean;
  outcome?: PreviewOutcome;
  loading: boolean;
  onFocusTile: (index: number) => void;
  onMenu: (index: number) => void;
  onDescend: (path: string) => void;
}

/**
 * One object or folder of the objects grid: its art, its name and its class.
 *
 * The art shows the still, or the kind glyph when there is none. The preview pool places a
 * playing canvas in `data-preview-stage`. The children badge is a sibling of the tile button,
 * because a button cannot contain another button.
 */
function ObjectTileInner({
  node,
  index,
  column,
  width,
  artHeight,
  nameType,
  focused,
  selected,
  outcome,
  loading,
  onFocusTile,
  onMenu,
  onDescend,
}: ObjectTileProps) {
  const open = useOpenObjectNode();
  const object = node.type === "object";
  const image = outcome?.kind === "image" ? outcome.src : null;

  return (
    <div
      role="gridcell"
      aria-colindex={column + 1}
      data-ui="ObjectTile"
      data-tile-index={index}
      className="relative min-w-0"
      style={{ width }}
      onContextMenu={() => onMenu(index)}
    >
      <Button
        variant="ghost"
        data-object-index={index}
        tabIndex={focused ? 0 : -1}
        aria-label={[node.name, object && node.declarations[0]?.class].filter(Boolean).join(" ")}
        aria-description={outcomeLabel(outcome)}
        aria-busy={loading}
        className={twMerge(
          "h-auto w-full min-w-0 flex-col items-center gap-1 rounded-md p-1.5 text-center font-normal select-none hover:bg-surface-veil focus-visible:ring-1 focus-visible:ring-accent-500",
          selected && "bg-accent-500/15 hover:bg-accent-500/15",
        )}
        onFocus={() => onFocusTile(index)}
        onClick={(event) => {
          if (object) {
            open(node, clickIntent(event));
          } else {
            onDescend(node.id);
          }
        }}
        onDoubleClick={() => {
          if (object) {
            open(node, "permanent");
          }
        }}
        title={tileTitle(node)}
      >
        <span
          className="relative grid w-full shrink-0 place-items-center overflow-hidden rounded-sm bg-surface-900"
          style={{ height: artHeight }}
        >
          {image !== null && (
            <img
              src={image}
              alt=""
              draggable={false}
              decoding="async"
              className="size-full object-contain"
            />
          )}
          {image === null && <TileGlyph node={node} />}
          <span data-preview-stage={index} className="absolute inset-0" />
          {loading && (
            <SpinnerGapIcon
              aria-hidden
              className="absolute bottom-1.5 left-1.5 size-3.5 animate-spin text-surface-300"
            />
          )}
          {outcome?.kind === "failed" && (
            <WarningCircleIcon
              aria-hidden
              className="absolute bottom-1.5 left-1.5 size-3.5 text-surface-400"
            />
          )}
        </span>
        <span
          className={twMerge(
            "line-clamp-2 w-full font-medium wrap-anywhere",
            nameType.className,
            selected ? "text-accent-100" : "text-surface-200",
          )}
        >
          {fitName(node.name, width, nameType, TILE_NAME_LINES)}
        </span>
        <span className={twMerge("w-full truncate text-surface-400", nameType.className)}>
          {object
            ? node.declarations[0]?.class
            : m.workshop_objects_count_label({ count: node.count })}
        </span>
      </Button>
      {node.count > 0 && (
        <span
          className="pointer-events-none absolute inset-x-1.5 top-1.5 flex items-end justify-end p-1"
          style={{ height: artHeight }}
        >
          <Tooltip content={m.workshop_objects_children_action({ count: node.count })}>
            <Button
              variant="ghost"
              size="xs"
              compact
              onClick={() => onDescend(node.id)}
              aria-label={m.workshop_objects_children_action({ count: node.count })}
              className="pointer-events-auto h-5 gap-0.5 rounded-sm bg-scrim px-1 text-fine text-surface-200 tabular-nums hover:bg-scrim hover:text-surface-50"
            >
              <FolderIcon weight="fill" className="size-3 text-folder-text" />
              {node.count}
              <CaretRightIcon weight="bold" className="size-2.5" />
            </Button>
          </Tooltip>
        </span>
      )}
    </div>
  );
}

export const ObjectTile = memo(ObjectTileInner);

function TileGlyph({ node }: { node: ObjectPrefixNode | ObjectRowNode }) {
  if (node.type === "prefix") {
    /* DS-KIND-HUE */
    return <FolderIcon weight="fill" className="h-2/5 w-2/5 text-folder-text" />;
  }

  const kind = objectPreviewKind(node);
  const Glyph = kind === null ? CubeIcon : KIND_GLYPH[kind];
  return <Glyph weight="duotone" className="h-2/5 w-2/5 text-bin-class-text/70" />;
}

function outcomeLabel(outcome: PreviewOutcome | undefined): string | undefined {
  if (outcome?.kind === "failed") return m.workshop_objects_preview_failed_label();
  if (outcome?.kind === "empty") return m.workshop_objects_preview_empty_label();
  return undefined;
}

/** The path, and for an object the file that declares it. */
function tileTitle(node: ObjectPrefixNode | ObjectRowNode): string {
  if (node.type === "prefix") return node.id;

  const [first] = node.declarations;
  if (first === undefined) return node.id;
  if (node.declarations.length > 1) {
    return `${node.id}\n${m.workshop_objects_files_label({ count: node.declarations.length })}`;
  }

  return `${node.id}\n${first.file}`;
}
