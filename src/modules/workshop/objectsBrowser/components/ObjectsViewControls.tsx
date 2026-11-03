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
import { shortcutOf } from "@/modules/keys";
import { twMerge } from "@/utils";

interface ObjectsViewControlsProps {
  view: "tree" | "grid";
  onViewChange: (view: "tree" | "grid") => void;
  thumbnails: boolean;
  onThumbnailsChange: (enabled: boolean) => void;
  size: number;
  onSizeChange: (size: number) => void;
  declaredObjects: boolean;
  onDeclaredObjectsChange: (enabled: boolean) => void;
  /**
   * The project's "Use game data declarations", which the Declared objects switch needs. Null
   * outside a project, which draws no switch.
   */
  declaring: boolean | null;
}

/** Object presentation and grid preferences, per DS-GLYPH-ROLE. */
export function ObjectsViewControls({
  view,
  onViewChange,
  thumbnails,
  onThumbnailsChange,
  size,
  onSizeChange,
  declaredObjects,
  onDeclaredObjectsChange,
  declaring,
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
        size="sm"
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
                icon={<SlidersHorizontalIcon />}
                aria-label={m.workshop_explorer_view_options_label()}
                disabled={view !== "grid" && declaring === null}
              />
            }
          />
        </Tooltip>
        <Popover.Content
          side="bottom"
          align="end"
          sideOffset={8}
          aria-label={m.workshop_explorer_view_options_label()}
          className="w-64 divide-y divide-surface-700 p-0 select-none"
        >
          {view === "grid" && (
            <>
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
                <p className="text-meta text-surface-400">
                  {m.workshop_objects_thumbnails_hint({ key: shortcutOf("objects.preview") })}
                </p>
              </div>
            </>
          )}
          {declaring !== null && (
            <div className="flex flex-col gap-2 p-3">
              <label
                className={twMerge(
                  "flex items-center justify-between gap-3 text-row text-surface-200",
                  !declaring && "text-surface-500",
                )}
              >
                {m.workshop_objects_declared_label()}
                <Switch
                  checked={declaring && declaredObjects}
                  disabled={!declaring}
                  onCheckedChange={onDeclaredObjectsChange}
                  aria-label={m.workshop_objects_declared_label()}
                />
              </label>
              <p className="text-meta text-surface-400">
                {declaring
                  ? m.workshop_objects_declared_hint()
                  : m.workshop_objects_declared_off_hint()}
              </p>
            </div>
          )}
        </Popover.Content>
      </Popover.Root>
    </div>
  );
}
