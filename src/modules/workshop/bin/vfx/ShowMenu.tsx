import { CaretDownIcon, EyeIcon } from "@phosphor-icons/react";

import { Button, Menu } from "@/components";
import { m } from "@/i18n";
import {
  usePreviewGizmo,
  usePreviewGround,
  usePreviewMidlane,
  usePreviewStats,
  useSetPreviewDisplay,
} from "@/stores";

/** The preview's overlays as ticks in one menu, which stays open while they are set. */
export function ShowMenu() {
  const ground = usePreviewGround();
  const midlane = usePreviewMidlane();
  const gizmo = usePreviewGizmo();
  const stats = usePreviewStats();
  const setDisplay = useSetPreviewDisplay();
  const shown = [ground, ground && midlane, gizmo, stats].filter(Boolean).length;

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            compact
            left={<EyeIcon weight="bold" className="h-4 w-4" />}
            right={<CaretDownIcon weight="bold" className="h-3 w-3" />}
          >
            {m.workshop_bin_preview_show_label()}
            <span className="ml-1 text-surface-400 tabular-nums">{shown}</span>
          </Button>
        }
      />
      <Menu.Portal>
        <Menu.Positioner align="end">
          <Menu.Popup data-ui="ShowMenu" className="w-44">
            <Menu.CheckboxItem
              checked={ground}
              onCheckedChange={(checked) => setDisplay({ previewGround: checked })}
            >
              {m.workshop_bin_preview_stage_label()}
            </Menu.CheckboxItem>
            <Menu.CheckboxItem
              checked={ground && midlane}
              disabled={!ground}
              onCheckedChange={(checked) => setDisplay({ previewMidlane: checked })}
            >
              {m.workshop_bin_preview_midlane_label()}
            </Menu.CheckboxItem>
            <Menu.CheckboxItem
              checked={gizmo}
              onCheckedChange={(checked) => setDisplay({ previewGizmo: checked })}
            >
              {m.workshop_bin_preview_gizmo_label()}
            </Menu.CheckboxItem>
            <Menu.CheckboxItem
              checked={stats}
              onCheckedChange={(checked) => setDisplay({ previewStats: checked })}
            >
              {m.workshop_bin_preview_stats_label()}
            </Menu.CheckboxItem>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}
