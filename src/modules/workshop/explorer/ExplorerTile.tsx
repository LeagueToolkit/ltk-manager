import { memo } from "react";

import { m } from "@/i18n";
import type { AssetRef } from "@/lib/tauri";
import { formatBytes, twMerge } from "@/utils";

import { ExplorerArt } from "./ExplorerArt";
import type { ExplorerItem } from "./items";
import { itemNameClass, itemStateClasses } from "./itemState";
import { fitName, type NameType, nameTypeFor } from "./tileName";

export interface ExplorerTileProps {
  item: ExplorerItem;
  /** The tile's drawn width in px, which the zoom has already been applied to. */
  size: number;
  /** The width a thumbnail is asked for, which is one of the six tile sizes. */
  requestWidth: number;
  /** The size line, which the two smallest tiles drop. */
  showFacts: boolean;
  selected: boolean;
  /** A selected directory holds this item, so it draws the fill at half strength. */
  covered: boolean;
  focused: boolean;
  thumbnails: boolean;
  /** Where the bytes come from, so a game chunk's `<img>` names its archive. */
  assetOf: (item: ExplorerItem) => AssetRef | null;
  index: number;
}

function ExplorerTileInner({
  item,
  size,
  requestWidth,
  showFacts,
  selected,
  covered,
  focused,
  thumbnails,
  assetOf,
  index,
}: ExplorerTileProps) {
  const nameType = nameTypeFor(requestWidth);

  return (
    <div
      role="gridcell"
      data-ui={`ExplorerTile:${item.kind}`}
      data-item-index={index}
      data-item-id={item.id}
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      style={{ width: `${size}px` }}
      className={twMerge(
        "flex shrink-0 cursor-pointer flex-col items-center gap-1 rounded-md p-1.5 outline-none select-none",
        "hover:bg-surface-veil",
        itemStateClasses({ selected, covered, focused }),
      )}
    >
      <ExplorerArt
        item={item}
        box={size}
        requestWidth={requestWidth}
        thumbnails={thumbnails}
        assetOf={assetOf}
        variant="tile"
      />
      {/* Sized by its own lines rather than by the reserve, so a one-line name
          keeps the size line under it instead of a hole. The row's height still
          reserves the whole reserve, which is what stops two rows overlapping. */}
      <span
        title={item.name}
        className={twMerge(
          "line-clamp-3 w-full text-center font-medium wrap-anywhere",
          nameType.className,
          itemNameClass(selected),
        )}
      >
        {fitName(item.name, size, nameType)}
      </span>
      <Facts item={item} showFacts={showFacts} nameType={nameType} />
    </div>
  );
}

export const ExplorerTile = memo(ExplorerTileInner);

/* The name's own tier at the plain weight, so the two stay in proportion at
   every tile size and the hierarchy comes from weight: DS-WEIGHT-TIER. */
function Facts({
  item,
  showFacts,
  nameType,
}: Pick<ExplorerTileProps, "item" | "showFacts"> & { nameType: NameType }) {
  if (!showFacts) return null;

  if (item.kind === "dir") {
    return (
      <span className={twMerge(nameType.className, "text-surface-500 tabular-nums")}>
        {m.workshop_explorer_tile_files_label({ count: item.fileCount })}
      </span>
    );
  }

  return (
    <span className={twMerge("font-mono tabular-nums", nameType.className, "text-surface-400")}>
      {formatBytes(item.entry.sizeBytes)}
    </span>
  );
}
