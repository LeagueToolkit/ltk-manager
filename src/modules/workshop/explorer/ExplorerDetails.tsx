import type { ReactNode } from "react";
import { useCallback, useMemo, useRef } from "react";

import { useZoomedPx } from "@/hooks";
import type { AssetRef } from "@/lib/tauri";
import {
  useExplorerColumns,
  useExplorerRowHeight,
  useExplorerSort,
  useSetExplorerSort,
  useZoomLevel,
} from "@/stores";
import { twMerge } from "@/utils";

import { columnTemplate, visibleColumns } from "./columns";
import { ART_REQUEST_WIDTH, artBoxFor, nameTypeForRow } from "./detailsRow";
import { ExplorerDetailsHeader } from "./ExplorerDetailsHeader";
import { ExplorerRow } from "./ExplorerRow";
import { type ExplorerRowAttributes, ExplorerSurface, useMeasuredWidth } from "./ExplorerSurface";
import { type ExplorerFileItem, type ExplorerItem, itemPath } from "./items";
import { itemStateClasses } from "./itemState";
import type { ExplorerSortField } from "./sort";
import type { ExplorerSelectionApi } from "./useExplorer";

/** The header's height in px before the zoom. A row's own height is a setting. */
const HEADER_HEIGHT = 26;

export interface ExplorerDetailsProps {
  items: readonly ExplorerItem[];
  thumbnails: boolean;
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
 * One directory as rows with columns, virtualized a row at a time.
 *
 * The list is what serves a modder reading a directory by its facts rather than
 * by its art: the size that the grid draws small and the kind that it draws as
 * a glyph both become a column a click sorts on.
 */
export function ExplorerDetails({
  items,
  thumbnails,
  selection,
  ariaLabel,
  onDescend,
  onOpen,
  onUp,
  assetOf,
  renderMenu,
  onRun,
}: ExplorerDetailsProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const zoomed = useZoomedPx();
  const zoomLevel = useZoomLevel();
  const widths = useExplorerColumns();
  const height = useExplorerRowHeight();
  const sort = useExplorerSort();
  const setSort = useSetExplorerSort();

  const width = useMeasuredWidth(scrollRef);
  /* The drop is about how much a reader fits, so it reads the pane at the zoom
     the columns were measured for rather than in the pixels it happens to own. */
  const columns = visibleColumns(Math.round((width * 100) / zoomLevel));
  const template = columnTemplate(columns, {
    size: zoomed(widths.size),
    kind: zoomed(widths.kind),
  });

  const rowHeight = zoomed(height);
  const artBox = zoomed(artBoxFor(height));
  const headerHeight = zoomed(HEADER_HEIGHT);
  const nameType = nameTypeForRow(height);
  const rowStyle = useMemo(() => ({ gridTemplateColumns: template }), [template]);

  const onSort = useCallback(
    (field: ExplorerSortField) => {
      if (field !== sort.field) {
        setSort({ field, direction: "asc" });
        return;
      }
      setSort({ field, direction: sort.direction === "asc" ? "desc" : "asc" });
    },
    [sort, setSort],
  );

  const rowAttrs = useCallback(
    (row: readonly ExplorerItem[], from: number, focused: number): ExplorerRowAttributes => {
      const item = row[0];
      if (!item) return {};

      const selected = selection.isSelected(item.id);
      return {
        "data-item-index": from,
        "data-item-id": item.id,
        "aria-selected": selected,
        tabIndex: from === focused ? 0 : -1,
        className: twMerge(
          "cursor-pointer rounded-sm outline-none hover:bg-surface-veil",
          nameType.className,
          itemStateClasses({
            selected,
            covered: selection.isCoveredPath(itemPath(item)),
            focused: from === focused,
          }),
        ),
      };
    },
    [selection, nameType],
  );

  return (
    <ExplorerSurface
      items={items}
      scrollRef={scrollRef}
      columns={1}
      rowHeight={rowHeight}
      selection={selection}
      ariaLabel={ariaLabel}
      dataUi="ExplorerDetails"
      scrollClassName="px-1 pb-2 select-none"
      rowClassName="grid items-center"
      rowStyle={rowStyle}
      rowAttrs={rowAttrs}
      headerHeight={headerHeight}
      header={
        <ExplorerDetailsHeader
          columns={columns}
          template={template}
          height={headerHeight}
          sortField={sort.field}
          sortDescending={sort.direction === "desc"}
          onSort={onSort}
        />
      }
      onDescend={onDescend}
      onOpen={onOpen}
      onUp={onUp}
      renderMenu={renderMenu}
      onRun={onRun}
      renderRow={(row) =>
        row.map((item) => (
          <ExplorerRow
            key={item.id}
            item={item}
            columns={columns}
            artBox={artBox}
            requestWidth={ART_REQUEST_WIDTH}
            thumbnails={thumbnails}
            selected={selection.isSelected(item.id)}
            assetOf={assetOf}
          />
        ))
      }
    />
  );
}
