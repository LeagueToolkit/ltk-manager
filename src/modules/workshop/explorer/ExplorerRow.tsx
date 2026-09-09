import { memo } from "react";

import { m } from "@/i18n";
import type { AssetRef } from "@/lib/tauri";
import { formatBytes, twMerge } from "@/utils";

import { fileKindFromPath } from "../gameBrowser/fileKind";
import { describeFileKind } from "../utils/fileKindIcon";
import type { ExplorerColumn } from "./columns";
import { ExplorerArt } from "./ExplorerArt";
import type { ExplorerItem } from "./items";
import { itemNameClass } from "./itemState";

export interface ExplorerRowProps {
  item: ExplorerItem;
  columns: readonly ExplorerColumn[];
  /** The art's box in px, which the zoom has already been applied to. */
  artBox: number;
  /** The width a thumbnail is asked for, which is the smallest tile size. */
  requestWidth: number;
  thumbnails: boolean;
  selected: boolean;
  assetOf: (item: ExplorerItem) => AssetRef | null;
}

/**
 * One item's cells, which the row around them lays out.
 *
 * The row owns the template, the fill and the focus, so these are cells and
 * nothing else: three of them under a wide pane and two under a narrow one.
 */
function ExplorerRowInner({
  item,
  columns,
  artBox,
  requestWidth,
  thumbnails,
  selected,
  assetOf,
}: ExplorerRowProps) {
  return (
    <>
      <span role="gridcell" className="flex min-w-0 items-center gap-2 pl-1.5">
        <ExplorerArt
          item={item}
          box={artBox}
          requestWidth={requestWidth}
          thumbnails={thumbnails}
          assetOf={assetOf}
          variant="row"
        />
        <span
          title={item.name}
          className={twMerge("truncate font-medium", itemNameClass(selected))}
        >
          {item.name}
        </span>
      </span>
      <span
        role="gridcell"
        className="truncate pr-3 text-right font-mono text-meta text-surface-400 tabular-nums"
      >
        {sizeCell(item)}
      </span>
      {columns.includes("kind") && (
        <span role="gridcell" className="truncate pr-2 text-meta text-surface-500">
          {kindCell(item)}
        </span>
      )}
    </>
  );
}

export const ExplorerRow = memo(ExplorerRowInner);

/* A directory reads what it holds, because no source totals the bytes below
   one, and a blank cell in a size column reads as a size of zero. */
function sizeCell(item: ExplorerItem): string {
  if (item.kind === "dir") return m.workshop_explorer_tile_files_label({ count: item.fileCount });
  return formatBytes(item.entry.sizeBytes);
}

function kindCell(item: ExplorerItem): string {
  if (item.kind === "dir") return m.workshop_explorer_kind_folder_label();
  const path = item.entry.path;
  return describeFileKind(path === null ? "unknown" : fileKindFromPath(path)).label;
}
