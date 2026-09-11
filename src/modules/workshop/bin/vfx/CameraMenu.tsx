import { CaretDownIcon, CheckIcon, VideoCameraIcon } from "@phosphor-icons/react";

import { Button, Menu } from "@/components";
import { m } from "@/i18n";
import { CAMERA_PRESETS, type CameraPreset } from "@/modules/viewport";
import { usePreviewCamera, useSetPreviewDisplay } from "@/stores";

const PRESET_LABEL: Record<CameraPreset, () => string> = {
  game: m.workshop_bin_preview_camera_game_label,
  orbit: m.workshop_bin_preview_camera_orbit_label,
  top: m.workshop_bin_preview_camera_top_label,
  front: m.workshop_bin_preview_camera_front_label,
  side: m.workshop_bin_preview_camera_side_label,
};

/**
 * Which camera the preview draws through, named on a pill over a menu of the five.
 *
 * The preset is a display preference, so every preview opens on the one a reader last
 * picked (ADR-0037).
 */
export function CameraMenu() {
  const camera = usePreviewCamera();
  const setDisplay = useSetPreviewDisplay();

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            compact
            aria-label={m.workshop_bin_preview_camera_label()}
            left={<VideoCameraIcon weight="bold" className="h-4 w-4" />}
            right={<CaretDownIcon weight="bold" className="h-3 w-3" />}
          >
            {PRESET_LABEL[camera]()}
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="end">
          <Menu.Popup data-ui="CameraMenu" className="w-36">
            {CAMERA_PRESETS.map((preset) => (
              <Menu.Item
                key={preset}
                icon={preset === camera && <CheckIcon weight="bold" className="h-4 w-4" />}
                onClick={() => setDisplay({ previewCamera: preset })}
              >
                {PRESET_LABEL[preset]()}
              </Menu.Item>
            ))}
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
