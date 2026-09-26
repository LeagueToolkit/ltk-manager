import { ListBulletsIcon, SlidersHorizontalIcon, SquaresFourIcon } from "@phosphor-icons/react";

import {
  FilterSection,
  IconButton,
  Popover,
  SegmentedControl,
  Slider,
  Switch,
  Tooltip,
} from "@/components";
import { m } from "@/i18n";
import { useInToolbarOverflow } from "@/modules/editor";
import { twMerge } from "@/utils";

interface ObjectsViewControlsProps {
  view: "tree" | "grid";
  onViewChange: (view: "tree" | "grid") => void;
  thumbnails: boolean;
  onThumbnailsChange: (enabled: boolean) => void;
  size: number;
  onSizeChange: (size: number) => void;
}

/** Object presentation and grid preferences, per DS-GLYPH-ROLE. */
export function ObjectsViewControls({
  view,
  onViewChange,
  thumbnails,
  onThumbnailsChange,
  size,
  onSizeChange,
}: ObjectsViewControlsProps) {
  const inOverflow = useInToolbarOverflow();

  return (
    <div
      className={twMerge(
        "flex shrink-0 items-center gap-1",
        !inOverflow && "border-l border-surface-veil-strong pl-2",
      )}
    >
      <SegmentedControl
        size="xs"
        value={view}
        onChange={onViewChange}
        aria-label={m.workshop_objects_view_label()}
        options={[
          {
            value: "tree",
            label: <ListBulletsIcon weight="bold" className="size-4" />,
            name: m.workshop_explorer_view_tree_label(),
          },
          {
            value: "grid",
            label: <SquaresFourIcon weight="bold" className="size-4" />,
            name: m.workshop_explorer_view_grid_label(),
          },
        ]}
      />
      <Popover.Root>
        <Tooltip content={m.workshop_explorer_view_options_label()}>
          <Popover.Trigger
            render={
              <IconButton
                size="xs"
                compact
                variant="ghost"
                icon={<SlidersHorizontalIcon weight="bold" className="size-4" />}
                aria-label={m.workshop_explorer_view_options_label()}
                disabled={view !== "grid"}
              />
            }
          />
        </Tooltip>
        <Popover.Portal>
          <Popover.Positioner side="bottom" align="end" sideOffset={8}>
            <Popover.Popup
              aria-label={m.workshop_explorer_view_options_label()}
              className="w-64 divide-y divide-surface-veil-strong bg-surface-900 p-0 select-none"
            >
              <FilterSection title={m.workshop_explorer_tile_size_label()}>
                <Slider
                  variant="ruler"
                  value={size}
                  onValueChange={onSizeChange}
                  min={96}
                  max={192}
                  step={32}
                  marks={[96, 128, 160, 192].map((value) => ({ value }))}
                  aria-label={m.workshop_explorer_tile_size_label()}
                />
              </FilterSection>
              <div className="flex flex-col gap-2 p-3">
                <label className="flex items-center justify-between gap-3 text-row text-surface-200">
                  {m.workshop_explorer_thumbnails_label()}
                  <Switch
                    checked={thumbnails}
                    onCheckedChange={onThumbnailsChange}
                    aria-label={m.workshop_explorer_thumbnails_label()}
                  />
                </label>
                <p className="text-meta text-surface-400">{m.workshop_objects_thumbnails_hint()}</p>
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
