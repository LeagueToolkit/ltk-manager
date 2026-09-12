import { CaretDownIcon, CheckIcon, CubeTransparentIcon } from "@phosphor-icons/react";

import { Button, Menu } from "@/components";
import { m } from "@/i18n";
import { type PreviewWireframe, usePreviewWireframe, useSetPreviewDisplay } from "@/stores";

const MODE_LABEL: Record<PreviewWireframe, () => string> = {
  off: m.workshop_bin_preview_wireframe_off_label,
  only: m.workshop_bin_preview_wireframe_only_label,
  overlay: m.workshop_bin_preview_wireframe_overlay_label,
};

/** The modes in the order the menu lists them. */
const MODES: readonly PreviewWireframe[] = ["off", "only", "overlay"];

/** Whether the preview draws the run shaded, as its edges, or its edges over the shading. */
export function WireframeMenu() {
  const mode = usePreviewWireframe();
  const setDisplay = useSetPreviewDisplay();

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            compact
            aria-label={m.workshop_bin_preview_wireframe_label()}
            left={<CubeTransparentIcon weight="bold" className="h-4 w-4" />}
            right={<CaretDownIcon weight="bold" className="h-3 w-3" />}
          >
            {MODE_LABEL[mode]()}
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="end">
          <Menu.Popup data-ui="WireframeMenu" className="w-48">
            {MODES.map((each) => (
              <Menu.Item
                key={each}
                icon={each === mode && <CheckIcon weight="bold" className="h-4 w-4" />}
                onClick={() => setDisplay({ previewWireframe: each })}
              >
                {MODE_LABEL[each]()}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
