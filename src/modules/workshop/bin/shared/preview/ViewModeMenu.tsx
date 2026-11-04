import { CaretDownIcon, CubeTransparentIcon } from "@phosphor-icons/react";

import { Button, Menu } from "@/components";
import { m } from "@/i18n";
import {
  ANTI_ALIASING_MODES,
  type AntiAliasing,
  offeredViewMode,
  takesWireOverlay,
  type ViewMode,
  viewModesOf,
} from "@/modules/viewport";
import {
  type PreviewEffectsQuality,
  usePreviewAntiAliasing,
  usePreviewEffectsQuality,
  usePreviewViewMode,
  usePreviewWireOverlay,
  useSetPreviewDisplay,
} from "@/stores";

const MODE_LABEL: Record<ViewMode, () => string> = {
  lit: m.workshop_bin_preview_view_lit_label,
  unshaded: m.workshop_bin_preview_view_unshaded_label,
  untextured: m.workshop_bin_preview_view_untextured_label,
  wireframe: m.workshop_bin_preview_view_wireframe_label,
  conformance: m.workshop_bin_preview_view_conformance_label,
};

export interface ViewModeMenuProps {
  /** The viewport draws a navigation grid, which offers the Conformance mode. */
  readonly navGrid?: boolean;
}

/** Every Effects Quality level, lowest first, as the client's settings list them. */
const QUALITIES: readonly PreviewEffectsQuality[] = [0, 1, 2, 3, 4];

const QUALITY_LABEL: Record<PreviewEffectsQuality, () => string> = {
  0: m.workshop_bin_preview_effects_quality_very_low_label,
  1: m.workshop_bin_preview_effects_quality_low_label,
  2: m.workshop_bin_preview_effects_quality_medium_label,
  3: m.workshop_bin_preview_effects_quality_high_label,
  4: m.workshop_bin_preview_effects_quality_very_high_label,
};

const ANTI_ALIASING_LABEL: Record<AntiAliasing, () => string> = {
  off: m.workshop_bin_preview_anti_aliasing_off_label,
  fxaa: m.workshop_bin_preview_anti_aliasing_fxaa_label,
  smaa: m.workshop_bin_preview_anti_aliasing_smaa_label,
};

/**
 * The preview's view mode, the wireframe overlay a lit or untextured mode takes, how the
 * frame's edges are smoothed, and the client's Effects Quality that every particle preview
 * simulates.
 */
export function ViewModeMenu({ navGrid = false }: ViewModeMenuProps) {
  const mode = offeredViewMode(usePreviewViewMode(), navGrid);

  return (
    <Menu.Root>
      <Menu.Trigger
        render={
          <Button
            variant="ghost"
            size="xs"
            aria-label={m.workshop_bin_preview_view_label()}
            left={<CubeTransparentIcon weight="bold" className="size-4" />}
            right={<CaretDownIcon weight="bold" className="size-3" />}
          >
            {MODE_LABEL[mode]()}
          </Button>
        }
      />
      <Menu.Content align="end" data-ui="ViewModeMenu" className="w-48">
        <ViewModeItems navGrid={navGrid} />
      </Menu.Content>
    </Menu.Root>
  );
}

/**
 * The items of `ViewModeMenu`, which a menu bar also draws as a submenu.
 *
 * A stored mode that the viewport does not offer shows as Lit, which the viewport draws.
 */
export function ViewModeItems({ navGrid = false }: ViewModeMenuProps) {
  const mode = offeredViewMode(usePreviewViewMode(), navGrid);
  const overlay = usePreviewWireOverlay();
  const antiAliasing = usePreviewAntiAliasing();
  const quality = usePreviewEffectsQuality();
  const setDisplay = useSetPreviewDisplay();

  return (
    <>
      <Menu.RadioGroup
        value={mode}
        onValueChange={(each) => setDisplay({ previewViewMode: each as ViewMode })}
      >
        {viewModesOf(navGrid).map((each) => (
          <Menu.RadioItem key={each} value={each}>
            {MODE_LABEL[each]()}
          </Menu.RadioItem>
        ))}
      </Menu.RadioGroup>
      <Menu.Separator />
      <Menu.CheckboxItem
        checked={overlay && takesWireOverlay(mode)}
        disabled={!takesWireOverlay(mode)}
        onCheckedChange={(checked) => setDisplay({ previewWireOverlay: checked })}
      >
        {m.workshop_bin_preview_view_wire_overlay_label()}
      </Menu.CheckboxItem>
      <Menu.Separator />
      <Menu.SubmenuRoot>
        <Menu.SubmenuTrigger>{m.workshop_bin_preview_anti_aliasing_label()}</Menu.SubmenuTrigger>
        <Menu.SubmenuContent data-ui="ViewModeMenu:antiAliasing">
          <Menu.RadioGroup
            value={antiAliasing}
            onValueChange={(each) => setDisplay({ previewAntiAliasing: each as AntiAliasing })}
          >
            {ANTI_ALIASING_MODES.map((each) => (
              <Menu.RadioItem key={each} value={each}>
                {ANTI_ALIASING_LABEL[each]()}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.SubmenuContent>
      </Menu.SubmenuRoot>
      <Menu.SubmenuRoot>
        <Menu.SubmenuTrigger>{m.workshop_bin_preview_effects_quality_label()}</Menu.SubmenuTrigger>
        <Menu.SubmenuContent data-ui="ViewModeMenu:effectsQuality">
          <Menu.RadioGroup
            value={quality}
            onValueChange={(each) =>
              setDisplay({ previewEffectsQuality: each as PreviewEffectsQuality })
            }
          >
            {QUALITIES.map((each) => (
              <Menu.RadioItem key={each} value={each}>
                {QUALITY_LABEL[each]()}
              </Menu.RadioItem>
            ))}
          </Menu.RadioGroup>
        </Menu.SubmenuContent>
      </Menu.SubmenuRoot>
    </>
  );
}
