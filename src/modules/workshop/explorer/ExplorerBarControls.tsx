/**
 * The controls at the explorer bar's trailing end.
 *
 * Everything here reads the application's own view settings rather than the
 * explorer's, because how a modder likes to read a directory travels with them
 * and where they are does not.
 */

import {
  ListBulletsIcon,
  RowsIcon,
  SlidersHorizontalIcon,
  SortAscendingIcon,
  SortDescendingIcon,
  SquaresFourIcon,
  XIcon,
} from "@phosphor-icons/react";
import { useCallback } from "react";

import {
  Button,
  Checkbox,
  FilterSection,
  IconButton,
  Popover,
  SegmentedControl,
  Slider,
  Switch,
  TogglePill,
  Tooltip,
} from "@/components";
import { m } from "@/i18n";
import {
  EXPLORER_ROW_HEIGHTS,
  EXPLORER_TILE_SIZES,
  type ExplorerSort,
  type ExplorerSortField,
  type ExplorerTileSize,
  type ExplorerView,
  useExplorerRowHeight,
  useExplorerSort,
  useExplorerThumbnails,
  useExplorerTileSize,
  useSetExplorerRowHeight,
  useSetExplorerSort,
  useSetExplorerThumbnails,
  useSetExplorerTileSize,
  useSetExplorerView,
} from "@/stores";
import { formatBytes } from "@/utils";

import { nearestRowHeight } from "./detailsRow";
import { type ExplorerFilter, filterIsActive, KIND_GROUPS, type KindGroupId } from "./filter";
import type { SelectionSummary } from "./selection";

const TILE_MARKS = EXPLORER_TILE_SIZES.map((value) => ({ value }));
const ROW_MARKS = EXPLORER_ROW_HEIGHTS.map((value) => ({ value }));

/**
 * The declared width nearest what the slider landed on.
 *
 * The six widths are not evenly spaced, so no single step reaches them and only
 * them. A thumb between two of them takes the nearer, which keeps `w` to the
 * six a session asks the asset scheme for.
 */
function nearestTileSize(value: number): ExplorerTileSize {
  return EXPLORER_TILE_SIZES.reduce((best, size) =>
    Math.abs(size - value) < Math.abs(best - value) ? size : best,
  );
}

/* Every label below is read at render rather than at load, because a message is
   a function of the locale and these lists outlive a change to it. */
const SORT_FIELDS: ReadonlyArray<{ field: ExplorerSortField; label: () => string }> = [
  { field: "name", label: () => m.workshop_explorer_sort_name_label() },
  { field: "size", label: () => m.workshop_explorer_sort_size_label() },
  { field: "kind", label: () => m.workshop_explorer_sort_kind_label() },
];

/** What each kind group is called, which the group itself does not carry. */
const KIND_GROUP_LABELS: Readonly<Record<KindGroupId, () => string>> = {
  textures: () => m.workshop_explorer_kind_textures_label(),
  meshes: () => m.workshop_explorer_kind_meshes_label(),
  animations: () => m.workshop_explorer_kind_animations_label(),
  data: () => m.workshop_explorer_kind_data_label(),
  audio: () => m.workshop_explorer_kind_audio_label(),
  other: () => m.workshop_explorer_kind_other_label(),
};

export function SelectionReadout({
  selection,
  onClear,
}: {
  selection: SelectionSummary;
  onClear: () => void;
}) {
  if (selection.files === 0) return null;

  /* A directory contributes its count and not its bytes, since no source totals
     them, so the size reads as a floor rather than as the whole. */
  const size = selection.sizeIsWhole
    ? formatBytes(selection.sizeBytes)
    : `${formatBytes(selection.sizeBytes)}+`;

  return (
    <span className="flex shrink-0 items-center gap-0.5 text-fine text-accent-300 tabular-nums">
      {m.workshop_explorer_selection_label({
        count: selection.files,
        formatted: selection.files.toLocaleString(),
        size,
      })}
      <IconButton
        icon={<XIcon weight="bold" className="h-3 w-3" />}
        variant="ghost"
        size="xs"
        compact
        onClick={onClear}
        aria-label={m.workshop_explorer_selection_clear_action()}
      />
    </span>
  );
}

export function ViewToggle({ view }: { view: ExplorerView }) {
  const setView = useSetExplorerView();

  return (
    <SegmentedControl
      size="xs"
      value={view}
      onChange={setView}
      aria-label={m.workshop_explorer_view_label()}
      options={[
        {
          value: "tree",
          label: <ListBulletsIcon weight="bold" className="h-4 w-4" />,
          name: m.workshop_explorer_view_tree_label(),
        },
        {
          value: "grid",
          label: <SquaresFourIcon weight="bold" className="h-4 w-4" />,
          name: m.workshop_explorer_view_grid_label(),
        },
        {
          value: "details",
          label: <RowsIcon weight="bold" className="h-4 w-4" />,
          name: m.workshop_explorer_view_details_label(),
        },
      ]}
    />
  );
}

export interface ExplorerOptionsProps {
  view: ExplorerView;
  filter: ExplorerFilter;
  onFilterChange: (filter: ExplorerFilter) => void;
}

/**
 * The sort, the filters and the tile settings, behind one trigger.
 *
 * Three triggers stood here and the bar had no width for them, so what is left
 * outside is the view toggle alone: it changes what the reader is looking at,
 * where everything in here only tunes it. Sliders, not a kebab: DS-GLYPH-ROLE.
 */
export function ExplorerOptions({ view, filter, onFilterChange }: ExplorerOptionsProps) {
  const sort = useExplorerSort();
  const setSort = useSetExplorerSort();
  const tileSize = useExplorerTileSize();
  const setTileSize = useSetExplorerTileSize();
  const rowHeight = useExplorerRowHeight();
  const setRowHeight = useSetExplorerRowHeight();
  const thumbnails = useExplorerThumbnails();
  const setThumbnails = useSetExplorerThumbnails();

  const pickField = (field: ExplorerSortField) => {
    const next: ExplorerSort =
      sort.field === field
        ? { field, direction: sort.direction === "asc" ? "desc" : "asc" }
        : { field, direction: "asc" };
    setSort(next);
  };

  const toggleKind = useCallback(
    (id: KindGroupId, on: boolean) => {
      const kinds = new Set(filter.kinds);
      if (on) kinds.add(id);
      else kinds.delete(id);
      onFilterChange({ ...filter, kinds });
    },
    [filter, onFilterChange],
  );

  const narrowed = filter.kinds.size > 0 || filter.unnamedOnly;
  const DirectionIcon = sort.direction === "asc" ? SortAscendingIcon : SortDescendingIcon;

  return (
    <Popover.Root>
      <Tooltip content={m.workshop_explorer_view_options_label()}>
        <Popover.Trigger
          render={
            <IconButton
              icon={<SlidersHorizontalIcon weight="bold" className="h-4 w-4" />}
              variant="ghost"
              size="xs"
              compact
              aria-label={m.workshop_explorer_view_options_label()}
              className={narrowed ? "text-accent-300" : undefined}
            />
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8}>
          <Popover.Popup
            aria-label={m.workshop_explorer_view_options_label()}
            className="w-64 divide-y divide-surface-600/50 bg-surface-900 p-0 select-none"
          >
            <FilterSection
              title={m.workshop_explorer_sort_section_label()}
              action={
                <Button
                  variant="ghost"
                  size="xs"
                  compact
                  right={<DirectionIcon weight="bold" className="h-3.5 w-3.5" />}
                  onClick={() => pickField(sort.field)}
                  className="text-fine text-accent-300"
                >
                  {sort.direction === "asc"
                    ? m.workshop_explorer_sort_ascending_label()
                    : m.workshop_explorer_sort_descending_label()}
                </Button>
              }
            >
              <div className="flex flex-wrap gap-1.5">
                {SORT_FIELDS.map((option) => (
                  <TogglePill
                    key={option.field}
                    label={option.label()}
                    active={sort.field === option.field}
                    onClick={() => pickField(option.field)}
                  />
                ))}
              </div>
            </FilterSection>

            {view !== "tree" && (
              <FilterSection
                title={m.workshop_explorer_kind_section_label()}
                action={
                  narrowed && (
                    <Button
                      variant="ghost"
                      size="xs"
                      compact
                      onClick={() =>
                        onFilterChange({ ...filter, kinds: new Set(), unnamedOnly: false })
                      }
                      className="text-fine text-accent-300"
                    >
                      {m.workshop_explorer_clear_filters_action()}
                    </Button>
                  )
                }
              >
                <div className="flex flex-col gap-1.5">
                  {KIND_GROUPS.map((group) => (
                    <Checkbox
                      key={group.id}
                      size="sm"
                      label={KIND_GROUP_LABELS[group.id]()}
                      checked={filter.kinds.has(group.id)}
                      onCheckedChange={(on) => toggleKind(group.id, on)}
                    />
                  ))}
                  <Checkbox
                    size="sm"
                    label={m.workshop_explorer_unnamed_label()}
                    checked={filter.unnamedOnly}
                    onCheckedChange={(on) => onFilterChange({ ...filter, unnamedOnly: on })}
                  />
                </div>
              </FilterSection>
            )}

            {view === "grid" && (
              <FilterSection title={m.workshop_explorer_tile_size_label()}>
                <Slider
                  variant="ruler"
                  value={tileSize}
                  onValueChange={(value) => setTileSize(nearestTileSize(value))}
                  min={EXPLORER_TILE_SIZES[0]}
                  max={EXPLORER_TILE_SIZES[EXPLORER_TILE_SIZES.length - 1]}
                  step={32}
                  marks={TILE_MARKS}
                  aria-label={m.workshop_explorer_tile_size_label()}
                />
              </FilterSection>
            )}

            {view === "details" && (
              <FilterSection title={m.workshop_explorer_row_height_label()}>
                <Slider
                  variant="ruler"
                  value={rowHeight}
                  onValueChange={(value) => setRowHeight(nearestRowHeight(value))}
                  min={EXPLORER_ROW_HEIGHTS[0]}
                  max={EXPLORER_ROW_HEIGHTS[EXPLORER_ROW_HEIGHTS.length - 1]}
                  step={4}
                  marks={ROW_MARKS}
                  aria-label={m.workshop_explorer_row_height_label()}
                />
              </FilterSection>
            )}

            {view !== "tree" && (
              <FilterSection
                title={m.workshop_explorer_thumbnails_label()}
                action={
                  <Switch
                    checked={thumbnails}
                    onCheckedChange={setThumbnails}
                    aria-label={m.workshop_explorer_thumbnails_action()}
                  />
                }
              >
                <p className="text-fine text-surface-400">
                  {m.workshop_explorer_thumbnails_description()}
                </p>
              </FilterSection>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export { filterIsActive };
