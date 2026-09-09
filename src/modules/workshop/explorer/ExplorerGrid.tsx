import type { ReactNode } from "react";
import { useMemo, useRef } from "react";

import { useZoomedPx } from "@/hooks";
import type { AssetRef } from "@/lib/tauri";

import { ExplorerSurface, useMeasuredWidth } from "./ExplorerSurface";
import { ExplorerTile } from "./ExplorerTile";
import { type ExplorerFileItem, type ExplorerItem, itemPath } from "./items";
import { NAME_LINES, nameTypeFor } from "./tileName";
import type { ExplorerSelectionApi } from "./useExplorer";

/** The gutter around a tile, which is what separates two of them. */
const CELL_GUTTER = 12;

/**
 * The tile's own padding and the gap under its art.
 *
 * A row's height is computed rather than measured, so every part of a tile that
 * is not the art has to be a number here or in [`tileName`](./tileName). A line
 * the tile draws and this does not count is a row overlapping the row below it.
 */
const TILE_PADDING = 6;
const TILE_GAP = 4;

export interface ExplorerGridProps {
  items: readonly ExplorerItem[];
  /** The tile width, which is also the width a thumbnail is asked for. */
  size: number;
  thumbnails: boolean;
  showFacts: boolean;
  selection: ExplorerSelectionApi;
  ariaLabel: string;
  onDescend: (path: string) => void;
  onOpen: (item: ExplorerFileItem) => void;
  onUp: () => void;
  assetOf: (item: ExplorerItem) => AssetRef | null;
  renderMenu?: (item: ExplorerItem | null) => ReactNode;
  onRun?: (how: "quick" | "dialog" | "copy") => void;
}

/**
 * One directory as tiles, virtualized a row at a time.
 *
 * The grid is what serves a modder who would know the texture on sight and does
 * not know its name. Everything it draws is a row the source already returned,
 * and the thumbnail is the one thing that reaches the backend.
 */
export function ExplorerGrid({
  items,
  size,
  thumbnails,
  showFacts,
  selection,
  ariaLabel,
  onDescend,
  onOpen,
  onUp,
  assetOf,
  renderMenu,
  onRun,
}: ExplorerGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomed = useZoomedPx();

  /* One measure for all three. A column count taken at the zoom while the tile
     draws at its raw width puts a row of tiles over the row below it. */
  const tileWidth = zoomed(size);
  const gutter = zoomed(CELL_GUTTER);
  const rowHeight =
    tileWidth +
    zoomed(nameTypeFor(size).line * NAME_LINES) +
    zoomed(TILE_PADDING * 2 + TILE_GAP * 2) +
    /* The size line reads at the name's own tier, so it costs one more of them. */
    (showFacts ? zoomed(nameTypeFor(size).line) : 0);

  const width = useMeasuredWidth(scrollRef);
  const columns = Math.max(1, Math.floor((width + CELL_GUTTER) / (tileWidth + gutter)));

  const rowStyle = useMemo(() => ({ gap: `${gutter}px` }), [gutter]);

  return (
    <ExplorerSurface
      items={items}
      scrollRef={scrollRef}
      columns={columns}
      rowHeight={rowHeight}
      selection={selection}
      ariaLabel={ariaLabel}
      dataUi="ExplorerGrid"
      scrollClassName="p-2"
      rowClassName="flex"
      rowStyle={rowStyle}
      onDescend={onDescend}
      onOpen={onOpen}
      onUp={onUp}
      renderMenu={renderMenu}
      onRun={onRun}
      renderRow={(row, from, focused) =>
        row.map((item, column) => (
          <ExplorerTile
            key={item.id}
            item={item}
            index={from + column}
            size={tileWidth}
            requestWidth={size}
            showFacts={showFacts}
            thumbnails={thumbnails}
            selected={selection.isSelected(item.id)}
            covered={selection.isCoveredPath(itemPath(item))}
            focused={from + column === focused}
            assetOf={assetOf}
          />
        ))
      }
    />
  );
}
