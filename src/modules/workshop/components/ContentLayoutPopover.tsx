import { SidebarSimpleIcon } from "@phosphor-icons/react";

import {
  Button,
  Checkbox,
  FilterSection,
  IconButton,
  Popover,
  SegmentedControl,
  Tooltip,
} from "@/components";
import {
  useLayerPanelOpen,
  useLayerPanelSide,
  useSetLayerPanelOpen,
  useSetLayerPanelSide,
} from "@/stores";

import { useResetLayout } from "../state";

const SIDE_OPTIONS = [
  { value: "left" as const, label: "Left" },
  { value: "right" as const, label: "Right" },
];

/** Where the layers explorer sits in the content browser, and whether it shows at all. */
export function ContentLayoutPopover() {
  const layerPanelSide = useLayerPanelSide();
  const setLayerPanelSide = useSetLayerPanelSide();
  const layerPanelOpen = useLayerPanelOpen();
  const setLayerPanelOpen = useSetLayerPanelOpen();
  const resetLayout = useResetLayout();

  return (
    <Popover.Root>
      <Tooltip content="Layout">
        <Popover.Trigger
          render={
            <IconButton
              icon={<SidebarSimpleIcon weight="bold" className="h-4 w-4" />}
              variant="ghost"
              size="sm"
              aria-label="Layout options"
            />
          }
        />
      </Tooltip>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="end" sideOffset={8}>
          <Popover.Popup
            aria-label="Layout options"
            className="w-56 divide-y divide-surface-600/50 p-0 select-none"
          >
            <FilterSection>
              <Checkbox
                size="sm"
                label="Show layers explorer"
                checked={layerPanelOpen}
                onCheckedChange={setLayerPanelOpen}
              />
            </FilterSection>

            {layerPanelOpen && (
              <FilterSection title="Layers explorer position">
                <SegmentedControl
                  options={SIDE_OPTIONS}
                  value={layerPanelSide}
                  onChange={setLayerPanelSide}
                />
              </FilterSection>
            )}

            <FilterSection>
              <Button variant="outline" size="sm" className="w-full" onClick={resetLayout}>
                Reset layout
              </Button>
            </FilterSection>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
