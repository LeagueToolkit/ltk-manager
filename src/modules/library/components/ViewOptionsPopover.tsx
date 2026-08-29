import { DotsThreeVerticalIcon } from "@phosphor-icons/react";

import { Checkbox, FilterSection, IconButton, Popover, Slider, Tooltip } from "@/components";
import { useSaveSettings, useSettings } from "@/modules/settings";
import { type CardScale, useCardScale, useSetCardScale, VALID_CARD_SCALES } from "@/stores";

const SCALE_MARKS = VALID_CARD_SCALES.map((value) => ({ value }));
const MIN_SCALE = VALID_CARD_SCALES[0];
const MAX_SCALE = VALID_CARD_SCALES[VALID_CARD_SCALES.length - 1];

/** Card size and what a card shows, behind the view toggle's caret. */
export function ViewOptionsPopover() {
  const { data: settings } = useSettings();
  const saveSettings = useSaveSettings();
  const cardScale = useCardScale();
  const setCardScale = useSetCardScale();

  if (!settings) return null;

  return (
    <Popover.Root>
      <Tooltip content="View options">
        <Popover.Trigger
          render={
            <IconButton
              icon={<DotsThreeVerticalIcon weight="bold" className="h-4 w-4" />}
              variant="ghost"
              size="sm"
              compact
              aria-label="View options"
              className="h-full w-auto rounded-none px-1"
            />
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8}>
          {/* A rung under the DS-GROUND default for floating UI, so it reads apart
              from the surface-800 toolbar it drops out of. */}
          <Popover.Popup
            aria-label="View options"
            className="w-64 divide-y divide-surface-600/50 bg-surface-900 p-0 select-none"
          >
            <FilterSection title="Card size">
              <Slider
                variant="ruler"
                value={cardScale}
                onValueChange={(value) => setCardScale(value as CardScale)}
                min={MIN_SCALE}
                max={MAX_SCALE}
                step={10}
                marks={SCALE_MARKS}
                aria-label="Card size"
              />
            </FilterSection>

            <FilterSection title="Card display">
              <Checkbox
                size="sm"
                label="Tags"
                checked={settings.showModTags}
                onCheckedChange={(checked) =>
                  saveSettings.mutate({ ...settings, showModTags: checked })
                }
              />
            </FilterSection>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
